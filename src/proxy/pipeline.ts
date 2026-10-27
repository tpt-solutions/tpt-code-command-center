import { UpstreamProvider, getConfig, workspaceRoots } from '../utils/config';
import { log } from '../utils/logger';
import { AnthropicRequest, Message, OpenAIRequest, ProxyRequest } from './types';
import { runVault } from '../modules/vault';
import { runSmartContext } from '../modules/smartContext';
import { createWeaveQuery } from '../modules/weave';
import { runTokenShield, buildCacheScope } from '../modules/tokenShield';
import { runMemoryWeaver } from '../modules/memoryWeaver';
import { runRouter } from '../modules/router';
import { runSilentEditInjection } from '../modules/silentEdit';
import { runMistralCacheKey, runPromptCache } from '../modules/promptCache';
import { storeInspectSnapshot } from '../utils/inspectStore';

export interface PipelineResult {
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  overrideUpstream?: { baseUrl: string; apiKey: string; model?: string; provider: UpstreamProvider };
  cachedResponse?: string;
  moduleActions: string[];
  // The request as the client sent it (after Vault), which is what Token Shield keys on.
  // The store must use this same input, or lookups and stores never line up.
  cacheKey?: { messages: Message[]; scope: Record<string, unknown> };
}

// The query object owns the skeleton cache, so it is reused across requests while the Weave
// settings and workspace roots stay the same. Building one per request threw the cache away.
let weaveMemo: { key: string; query: ReturnType<typeof createWeaveQuery> } | undefined;

function sharedWeaveQuery(config: ReturnType<typeof getConfig>): ReturnType<typeof createWeaveQuery> {
  const roots = workspaceRoots();
  const key = JSON.stringify({ cliPath: config.weave.cliPath, level: config.weave.level, roots });
  if (weaveMemo?.key !== key) {
    weaveMemo = {
      key,
      query: createWeaveQuery({ cliPath: config.weave.cliPath, roots, level: config.weave.level }),
    };
  }
  return weaveMemo.query;
}

export async function runPipeline(req: ProxyRequest): Promise<PipelineResult> {
  const config = getConfig();
  const actions: string[] = [];
  let body = req.body as AnthropicRequest | OpenAIRequest;
  const originalBody = req.body;

  if (config.terminal.verboseLogging) {
    log(`Pipeline start — path=${req.path} format=${req.format}`, true);
  }

  // 1. Vault: redact secrets before anything else sees the content
  if (config.vault.enabled) {
    const result = runVault(body, config.vault.customRegex);
    body = result.body as AnthropicRequest | OpenAIRequest;
    if (result.redacted > 0) {
      actions.push(`vault:redacted=${result.redacted}`);
      log(`Vault redacted ${result.redacted} secret(s)`);
    }
  }

  // 2. Token Shield: check cache before hitting upstream (skip for streaming — cached responses
  //    are buffered JSON, not SSE, so returning one to a streaming client would break the protocol)
  const isStreaming = !!(body as Record<string, unknown>).stream;
  const cacheKey = 'messages' in body && Array.isArray(body.messages)
    ? { messages: body.messages as Message[], scope: buildCacheScope(body as Record<string, unknown>, req.format) }
    : undefined;
  if (config.tokenShield.enabled && !isStreaming && cacheKey) {
    const cached = await runTokenShield(cacheKey.messages, config.tokenShield, cacheKey.scope);
    if (cached) {
      actions.push('tokenShield:hit');
      log('Token Shield cache hit — skipping upstream');
      storeInspectSnapshot({ timestamp: Date.now(), format: req.format, originalBody, processedBody: body, moduleActions: [...actions], cacheHit: true });
      return { body, cachedResponse: cached, moduleActions: actions };
    }
  }

  // 3. Memory Weaver: summarise if conversation is too long
  if (config.memoryWeaver.enabled && 'messages' in body && Array.isArray(body.messages)) {
    const result = await runMemoryWeaver(body.messages, config.memoryWeaver);
    if (result.summarised) {
      body = { ...body, messages: result.messages };
      actions.push(`memoryWeaver:summarised`);
    }
  }

  // 4. Smart Context: replace file content with AST outlines in tool results.
  //    When tpt-weave is enabled and the workspace has an index, Rust files
  //    get their skeleton from the shared index instead (spec.md §32).
  if (config.smartContext.enabled && 'messages' in body && Array.isArray(body.messages)) {
    const weave = config.weave.enabled ? sharedWeaveQuery(config) : undefined;
    const result = await runSmartContext(body.messages, config.smartContext.maxFileSize, weave);
    if (result.weaveReplaced > 0) {
      actions.push(`weave:skeleton=${result.weaveReplaced}`);
    }
    if (result.replaced > 0) {
      body = { ...body, messages: result.messages };
      actions.push(`smartContext:replaced=${result.replaced}`);
    }
  }

  // 5. Router: rewrite model/provider based on heuristics. Runs before the provider-specific
  //    steps below, so they see the provider the request will actually be sent to.
  let overrideUpstream: PipelineResult['overrideUpstream'];
  if (config.router.enabled) {
    const routeResult = runRouter(body, config.router.rules, req.format);
    if (routeResult) {
      overrideUpstream = routeResult;
      // Without this the routed provider receives the client's original model name
      if (routeResult.model) {
        body = { ...body, model: routeResult.model } as AnthropicRequest | OpenAIRequest;
      }
      actions.push(`router:${routeResult.model}@${routeResult.baseUrl}`);
    }
  }
  const effectiveProvider = overrideUpstream?.provider ?? config.upstreamProvider;

  // 6. Silent Edit: prepend schema instructions to system prompt
  if (config.silentEdit.enabled) {
    body = runSilentEditInjection(body, req.format) as AnthropicRequest | OpenAIRequest;
    actions.push('silentEdit:injected');
  }

  // 7. Prompt Cache: mark stable content for Anthropic's native caching discount
  if (config.promptCache.enabled && req.format === 'anthropic') {
    const result = runPromptCache(body as AnthropicRequest);
    body = result.body;
    if (result.breakpoints > 0) {
      actions.push(`promptCache:breakpoints=${result.breakpoints}`);
    }
  }

  // 8. Mistral has no automatic caching — set a stable prompt_cache_key instead. Only for
  //    requests that really go to Mistral: other providers may reject the unknown field.
  if (effectiveProvider === 'mistral' && req.format === 'openai') {
    const result = runMistralCacheKey(body as OpenAIRequest);
    body = result.body;
    if (result.applied) {
      actions.push('promptCache:mistralKey');
    }
  }

  if (config.terminal.verboseLogging) {
    log(`Pipeline complete — actions=[${actions.join(', ')}]`, true);
  }

  storeInspectSnapshot({ timestamp: Date.now(), format: req.format, originalBody, processedBody: body, moduleActions: [...actions], overrideUpstream, cacheHit: false });
  return { body, overrideUpstream, moduleActions: actions, cacheKey };
}
