import { UpstreamProvider, getConfig, workspaceRoots } from '../utils/config';
import { log } from '../utils/logger';
import { AnthropicRequest, Message, OpenAIRequest, ProxyRequest } from './types';
import { runVault } from '../modules/vault';
import { runSmartContext } from '../modules/smartContext';
import { createWeaveQuery } from '../modules/weave';
import { runTokenShield, buildCacheScope } from '../modules/tokenShield';
import { runMemoryWeaver } from '../modules/memoryWeaver';
import { providerFormat, runRouter } from '../modules/router';
import { anthropicRequestToOpenAI, openAIRequestToAnthropic } from '../modules/translate';
import { runSilentEditInjection } from '../modules/silentEdit';
import { runMistralCacheKey, runPromptCache } from '../modules/promptCache';
import { loadInstalledForge } from '../modules/forge';
import { selectRecall, readMemorySummaries, recallNote, prependSystemText, lastUserText, isFirstTurn } from '../modules/recall';
import { storeInspectSnapshot, StageTokens } from '../utils/inspectStore';
import { countTokens } from '../ledger/ledger';

export interface PipelineResult {
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  // Estimated input size after each stage: what each module saved, or added, on this request
  stageTokens: StageTokens[];
  overrideUpstream?: { baseUrl: string; apiKey: string; model?: string; provider: UpstreamProvider };
  cachedResponse?: string;
  moduleActions: string[];
  // The request as the client sent it (after Vault), which is what Token Shield keys on.
  // The store must use this same input, or lookups and stores never line up.
  cacheKey?: { messages: Message[]; scope: Record<string, unknown> };
  // The body was converted to the other API format (either direction); the response must be converted back
  translated?: boolean;
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
  // Forge configs the user installed into .tpt/forge/ (vault patterns, router rules, prompt text)
  const forge = loadInstalledForge();
  const actions: string[] = [];
  let body = req.body as AnthropicRequest | OpenAIRequest;
  const originalBody = req.body;

  if (config.terminal.verboseLogging) {
    log(`Pipeline start — path=${req.path} format=${req.format}`, true);
  }

  // Per-stage size, so the savings of each module can be read off the last request
  const stageTokens: StageTokens[] = [];
  const mark = (stage: string): void => {
    stageTokens.push({ stage, tokens: countTokens(body as AnthropicRequest | OpenAIRequest) });
  };
  mark('original');

  // 1. Vault: redact secrets before anything else sees the content
  if (config.vault.enabled) {
    const result = runVault(body, [...config.vault.customRegex, ...forge.vaultPatterns]);
    body = result.body as AnthropicRequest | OpenAIRequest;
    if (result.redacted > 0) {
      actions.push(`vault:redacted=${result.redacted}`);
      log(`Vault redacted ${result.redacted} secret(s)`);
    }
  }
  mark('vault');

  // 2. Token Shield: check cache before hitting upstream (skip for streaming — cached responses
  //    are buffered JSON, not SSE, so returning one to a streaming client would break the protocol)
  const isStreaming = !!(body as Record<string, unknown>).stream;
  // count_tokens shares its messages with a real chat request, so it must never be cached or stored
  // as the answer to one, and it must not call a summariser. It only needs a count.
  const countTokensOnly = req.path.split('?')[0] === '/v1/messages/count_tokens';
  const cacheKey = !countTokensOnly && 'messages' in body && Array.isArray(body.messages)
    ? { messages: body.messages as Message[], scope: buildCacheScope(body as Record<string, unknown>, req.format) }
    : undefined;
  // A dry run never answers from the cache: it measures the request the way it would be sent
  if (config.tokenShield.enabled && !config.dryRun && !isStreaming && cacheKey) {
    const cached = await runTokenShield(cacheKey.messages, config.tokenShield, cacheKey.scope);
    if (cached) {
      actions.push('tokenShield:hit');
      log('Token Shield cache hit — skipping upstream');
      storeInspectSnapshot({ timestamp: Date.now(), format: req.format, originalBody, processedBody: body, moduleActions: [...actions], cacheHit: true, stageTokens, dryRun: config.dryRun });
      return { body, cachedResponse: cached, moduleActions: actions, stageTokens };
    }
  }

  // 3. Memory Weaver: summarise if conversation is too long. A dry run uses only the local
  //    extractive backend: the Ollama and proxy backends would call a model, which is traffic.
  if (config.memoryWeaver.enabled && !countTokensOnly && 'messages' in body && Array.isArray(body.messages)) {
    const weaverOptions = config.dryRun ? { ...config.memoryWeaver, fallbackOrder: ['extractive'] } : config.memoryWeaver;
    const result = await runMemoryWeaver(body.messages, weaverOptions);
    if (result.summarised) {
      body = { ...body, messages: result.messages };
      actions.push(`memoryWeaver:summarised`);
    }
  }
  mark('memoryWeaver');

  // 3b. Cross-session recall (opt-in): on the first turn of a conversation, add the summaries from
  //     earlier sessions that share words with the request. They go in the system prompt.
  if (config.memoryWeaver.recallEnabled && !countTokensOnly && 'messages' in body && Array.isArray(body.messages) &&
      isFirstTurn(body.messages as Message[])) {
    const recalled = selectRecall(readMemorySummaries(), lastUserText(body.messages as Message[]));
    if (recalled.length > 0) {
      body = prependSystemText(body as Record<string, unknown>, req.format, recallNote(recalled)) as AnthropicRequest | OpenAIRequest;
      actions.push(`memoryRecall:${recalled.length}`);
    }
  }
  mark('memoryRecall');

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
  mark('smartContext');

  // 5. Router: rewrite model/provider based on heuristics. Runs before the provider-specific
  //    steps below, so they see the provider the request will actually be sent to.
  let overrideUpstream: PipelineResult['overrideUpstream'];
  if (config.router.enabled) {
    // User-written rules win; installed Forge rules apply only when the user has none
    const rules = config.router.rules.length > 0 ? config.router.rules : forge.routerRules;
    const routeResult = runRouter(body, rules);
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
    body = runSilentEditInjection(body, req.format, forge.systemPrompt) as AnthropicRequest | OpenAIRequest;
    actions.push('silentEdit:injected');
  }
  mark('silentEdit');

  // 7. Translation, OpenAI-format client to Anthropic. Only the chat endpoint is translated, and only
  //    when the provider is Anthropic itself: that is known, so it needs no router rule. Other
  //    endpoints such as GET /v1/models pass through. Silent Edit may have added a messages array
  //    to them, so the path is what decides.
  const toAnthropic = req.format === 'openai' && req.path.split('?')[0] === '/v1/chat/completions' &&
    effectiveProvider === 'anthropic' && Array.isArray((body as OpenAIRequest).messages);
  if (toAnthropic) {
    body = openAIRequestToAnthropic(body as Record<string, unknown>) as AnthropicRequest;
    actions.push('translate:openai->anthropic');
  }

  // 8. Prompt Cache: mark stable content for Anthropic's native caching discount. By now an
  //    Anthropic-bound request is in Anthropic shape, whichever format the client sent.
  if (config.promptCache.enabled && (req.format === 'anthropic' || toAnthropic)) {
    const result = runPromptCache(body as AnthropicRequest);
    body = result.body;
    if (result.breakpoints > 0) {
      actions.push(`promptCache:breakpoints=${result.breakpoints}`);
    }
  }

  // 9. Translation, Anthropic-format client to an OpenAI-compatible provider. Only when routed there:
  //    some providers in the OpenAI group (local, custom) also serve the Anthropic format.
  //    The server converts the answer back.
  const translated = req.format === 'anthropic' && !!overrideUpstream && providerFormat(effectiveProvider) === 'openai';
  if (translated) {
    body = anthropicRequestToOpenAI(body as Record<string, unknown>) as AnthropicRequest | OpenAIRequest;
    actions.push('translate:anthropic->openai');
  }

  // 10. Mistral has no automatic caching — set a stable prompt_cache_key instead. Only for
  //    requests that really go to Mistral: other providers may reject the unknown field.
  if (effectiveProvider === 'mistral' && (req.format === 'openai' || translated)) {
    const result = runMistralCacheKey(body as OpenAIRequest);
    body = result.body;
    if (result.applied) {
      actions.push('promptCache:mistralKey');
    }
  }

  if (config.terminal.verboseLogging) {
    log(`Pipeline complete — actions=[${actions.join(', ')}]`, true);
  }

  // Translation and the Mistral cache key are the last changes to the body
  mark('translate');
  storeInspectSnapshot({ timestamp: Date.now(), format: req.format, originalBody, processedBody: body, moduleActions: [...actions], overrideUpstream, cacheHit: false, stageTokens, dryRun: config.dryRun });
  // `translated` is set in both directions; the server reads the client format to tell them apart
  return { body, overrideUpstream, moduleActions: actions, cacheKey, translated: translated || toAnthropic, stageTokens };
}
