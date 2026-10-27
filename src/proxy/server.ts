import * as http from 'http';
import * as net from 'net';
import * as https from 'https';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { getConfig, resolveUpstreamUrl, UpstreamProvider } from '../utils/config';
import { log } from '../utils/logger';
import { hashString } from '../utils/hash';
import { runPipeline } from './pipeline';
import { recordRequest } from '../ledger/ledger';
import { storeCachedResponse, responseHasToolCall } from '../modules/tokenShield';
import { handleSilentEditResponse, handleSilentEditStreamResponse } from '../modules/silentEdit';
import { AnthropicRequest, OpenAIRequest, ProxyRequest } from './types';
import { countTokens, getTodayCostUsd, getThisMonthCostUsd } from '../ledger/ledger';
import { getCostUsd, initPricing } from '../ledger/pricing';
import { captureRateLimitHeaders, recordActivity } from '../modules/quotaTracker';
import { readUpstreamUsage } from '../ledger/usage';
import { markConnected } from '../utils/connection';
import {
  OpenAIStreamToAnthropic, AnthropicStreamToOpenAI, anthropicErrorBody, openAIErrorBody,
  openAIResponseToAnthropic, anthropicResponseToOpenAI,
} from '../modules/translate';
import { StringDecoder } from 'string_decoder';
import { StreamBuffer } from '../utils/streamBuffer';
import { bearerToken, buildUpstreamPath, isAllowedPath, pathOnly, tokenMatches, upstreamRequestPath } from './requestPaths';

const PREFERRED_PORT = 7331;
const MAX_PORT_ATTEMPTS = 10;
// Idle timeouts: a non-streaming response sends nothing until it is complete, so it gets a
// longer window than a stream, where a gap between chunks means the upstream has stalled.
const NON_STREAM_IDLE_MS = 10 * 60 * 1000;
const STREAM_IDLE_MS = 2 * 60 * 1000;

// Only forward a safe subset of upstream response headers to avoid header injection
// or leaking internal provider headers (set-cookie, x-internal-*, etc.)
const SAFE_RESPONSE_HEADERS = new Set([
  'content-type', 'content-length', 'retry-after', 'x-request-id', 'date',
  // Anthropic rate-limit headers (requests + tokens)
  'anthropic-ratelimit-requests-limit', 'anthropic-ratelimit-requests-remaining',
  'anthropic-ratelimit-tokens-limit', 'anthropic-ratelimit-tokens-remaining',
  'anthropic-ratelimit-tokens-reset', 'anthropic-ratelimit-requests-reset',
  // OpenAI / xAI / compatible providers
  'x-ratelimit-limit-requests', 'x-ratelimit-remaining-requests', 'x-ratelimit-reset-requests',
  'x-ratelimit-limit-tokens', 'x-ratelimit-remaining-tokens', 'x-ratelimit-reset-tokens',
]);

function filterResponseHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SAFE_RESPONSE_HEADERS.has(k.toLowerCase()) && typeof v === 'string') {
      safe[k] = v;
    }
  }
  return safe;
}
// xAI recommends a stable x-grok-conv-id header so repeated requests in the same
// conversation route to the same server, maximizing their automatic cache hit rate.
// Derived from the first non-system message so it stays stable across turns.
function grokConversationHeaders(upstreamProvider: UpstreamProvider, body: Record<string, unknown>): Record<string, string> {
  if (upstreamProvider !== 'grok') return {};
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return {};
  const first = messages.find((m) => (m as { role?: string })?.role !== 'system') ?? messages[0];
  const content = (first as { content?: unknown })?.content;
  if (content === undefined) return {};
  return { 'x-grok-conv-id': `tpt-${hashString(JSON.stringify(content)).slice(0, 32)}` };
}

let server: http.Server | undefined;
let activePort: number | undefined;
let sessionToken: string | undefined;
let serverState: 'starting' | 'running' | 'error' = 'starting';
let serverError: string | undefined;
let pricingTimer: NodeJS.Timeout | undefined;

// 127.0.0.1 rather than "localhost": Node 17+ resolves localhost to ::1 first, and the
// server only listens on IPv4, which made clients hang on connect.
export function getProxyUrl(): string | undefined {
  return activePort ? `http://127.0.0.1:${activePort}` : undefined;
}

export function getSessionToken(): string | undefined {
  return sessionToken;
}

export function getServerState(): { state: typeof serverState; error?: string } {
  return { state: serverState, error: serverError };
}

async function findFreePort(start: number): Promise<number> {
  if (start > 65535) throw new Error('No free TCP port available for the TPT proxy');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(start, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', (err: NodeJS.ErrnoException) => {
      // Only a taken port should move us along; anything else (EACCES, etc.) is a real failure
      if (err.code === 'EADDRINUSE') {
        findFreePort(start + 1).then(resolve, reject);
      } else {
        reject(err);
      }
    });
  });
}

function detectFormat(path: string): 'anthropic' | 'openai' {
  if (path.startsWith('/v1/messages')) return 'anthropic';
  return 'openai';
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    req.on('data', (c: Buffer) => {
      totalBytes += c.length;
      if (totalBytes > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendErrorJson(res: http.ServerResponse, status: number, message: string): void {
  if (!res.headersSent) {
    res.writeHead(status, { 'content-type': 'application/json' });
  }
  res.end(JSON.stringify({ error: message }));
}

// Builds the outgoing headers for a provider. Auth style follows the provider the request
// is actually sent to, which may differ from the global setting when the router picks another.
function buildOutHeaders(
  apiKey: string,
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  upstreamProvider: UpstreamProvider,
  extraHeaders: Record<string, string>
): Record<string, string> {
  const outHeaders: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
  };

  if (apiKey) {
    if (upstreamProvider === 'anthropic') {
      outHeaders['x-api-key'] = apiKey;
      outHeaders['anthropic-version'] = '2023-06-01';
    } else {
      outHeaders['authorization'] = `Bearer ${apiKey}`;
    }
  }

  const passthroughHeaders = ['accept', 'user-agent', 'anthropic-version', 'anthropic-beta'];
  for (const h of passthroughHeaders) {
    if (originalHeaders[h]) {
      outHeaders[h] = originalHeaders[h] as string;
    }
  }

  Object.assign(outHeaders, extraHeaders);
  return outHeaders;
}

function forwardRequest(
  targetUrl: string,
  apiKey: string,
  path: string,
  method: string,
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  _format: 'anthropic' | 'openai',
  upstreamProvider: UpstreamProvider,
  extraHeaders: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const outHeaders = buildOutHeaders(apiKey, originalHeaders, body, upstreamProvider, extraHeaders);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: buildUpstreamPath(url.pathname, path),
      method,
      headers: outHeaders,
    };

    const proto = url.protocol === 'https:' ? https : http;
    const outReq = proto.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 500,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      );
    });
    outReq.setTimeout(NON_STREAM_IDLE_MS, () => outReq.destroy(new Error('upstream idle timeout')));
    outReq.on('error', reject);
    outReq.write(body);
    outReq.end();
  });
}

// Forward a streaming request, piping SSE chunks directly to clientRes.
// Returns the full accumulated body text (for token counting) and status code.
// If the upstream returns a non-SSE error response it is buffered and forwarded as JSON.
function forwardStreamingRequest(
  targetUrl: string,
  apiKey: string,
  path: string,
  method: string,
  originalHeaders: http.IncomingHttpHeaders,
  body: string,
  _format: 'anthropic' | 'openai',
  upstreamProvider: UpstreamProvider,
  clientRes: http.ServerResponse,
  extraHeaders: Record<string, string> = {},
  translator?: OpenAIStreamToAnthropic | AnthropicStreamToOpenAI
): Promise<{ accumulated: string; status: number }> {
  return new Promise((resolve) => {
    const url = new URL(targetUrl);
    const outHeaders = buildOutHeaders(apiKey, originalHeaders, body, upstreamProvider, extraHeaders);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: buildUpstreamPath(url.pathname, path),
      method,
      headers: outHeaders,
    };

    const proto = url.protocol === 'https:' ? https : http;
    const outReq = proto.request(options, (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 500;
      const contentType = upstreamRes.headers['content-type'] ?? '';
      const isSSE = contentType.includes('text/event-stream');
      const chunks: Buffer[] = [];

      if (!isSSE || status !== 200) {
        // Non-streaming error — buffer and forward as JSON
        upstreamRes.on('data', (c: Buffer) => chunks.push(c));
        upstreamRes.on('end', () => {
          const responseBody = Buffer.concat(chunks).toString('utf8');
          if (!clientRes.headersSent) {
            clientRes.writeHead(status, { 'content-type': 'application/json' });
          }
          // The client gets an error in its own format
          const errorBody = !translator ? responseBody
            : translator instanceof AnthropicStreamToOpenAI ? openAIErrorBody(responseBody)
            : anthropicErrorBody(responseBody);
          clientRes.end(errorBody);
          resolve({ accumulated: responseBody, status });
        });
        return;
      }

      // SSE — set streaming headers and pipe chunks through
      clientRes.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
      });

      // Decode across chunk boundaries, so a multi-byte character split by the network survives
      const decoder = new StringDecoder('utf8');
      const buffer = new StreamBuffer();
      upstreamRes.on('data', (chunk: Buffer) => {
        buffer.push(chunk);
        // A translated stream goes out as the client's format; the raw chunks stay for accounting
        const out = translator ? translator.push(decoder.write(chunk)) : chunk;
        // Respect backpressure: a slow client pauses the upstream instead of growing memory
        if (!clientRes.write(out)) {
          upstreamRes.pause();
          clientRes.once('drain', () => upstreamRes.resume());
        }
      });

      upstreamRes.on('end', () => {
        if (translator) {
          const tail = translator.push(decoder.end()) + translator.end();
          if (tail) clientRes.write(tail);
        }
        clientRes.end();
        if (buffer.wasTruncated) {
          log('Stream was longer than the accounting buffer: kept its start and end. Silent Edit blocks in the middle are not applied.');
        }
        resolve({ accumulated: buffer.text(), status });
      });

      // A stream cut off mid-way is a failure: it must not be recorded or cached as a success
      upstreamRes.on('error', () => {
        clientRes.end();
        resolve({ accumulated: buffer.text(), status: 502 });
      });
    });

    outReq.setTimeout(STREAM_IDLE_MS, () => outReq.destroy(new Error('upstream idle timeout')));

    // Client went away: stop the upstream so it stops generating (and billing) tokens
    clientRes.on('close', () => {
      if (!clientRes.writableFinished) outReq.destroy();
    });

    outReq.on('error', (e) => {
      if (!clientRes.headersSent) {
        clientRes.writeHead(502, { 'content-type': 'application/json' });
        clientRes.end(JSON.stringify({ error: `Upstream streaming error: ${e}` }));
      } else if (!clientRes.writableEnded) {
        clientRes.end();
      }
      resolve({ accumulated: '', status: 502 });
    });

    outReq.write(body);
    outReq.end();
  });
}

// The port the terminals were last given, remembered across activations so a move can be reported
let terminalState: vscode.Memento | undefined;

export async function startProxyServer(context: vscode.ExtensionContext): Promise<void> {
  terminalState = context.globalState;
  sessionToken = context.globalState.get<string>('tpt.sessionToken');
  if (!sessionToken) {
    sessionToken = crypto.randomBytes(32).toString('hex');
    await context.globalState.update('tpt.sessionToken', sessionToken);
  }

  // Kick off non-blocking pricing fetch (uses cached data on subsequent activations), then
  // check hourly; initPricing itself only refetches once the cache is a day old
  const refreshPricing = () => initPricing(getConfig().openrouterApiKey).catch(() => { /* ignore network errors */ });
  refreshPricing();
  pricingTimer = setInterval(refreshPricing, 60 * 60 * 1000);
  pricingTimer.unref();

  const handleRequest = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const config = getConfig();

    // Security: require session token on all requests
    // The token may arrive in X-TPT-Token, or in the key field clients already have:
    // Authorization: Bearer (Roo Code, Continue, Cline) or x-api-key (Claude Code).
    // The provider key is still added by the proxy, so these headers carry no real secret.
    const authorized = tokenMatches(req.headers['x-tpt-token'], sessionToken)
      || tokenMatches(bearerToken(req.headers.authorization), sessionToken)
      || tokenMatches(req.headers['x-api-key'], sessionToken);
    if (!authorized) {
      sendErrorJson(res, 401,
        'Unauthorized: missing or invalid session token. Send it as the X-TPT-Token header, ' +
        'or as the API key in the client (Authorization: Bearer or x-api-key). ' +
        'Run "TPT: Copy Session Token" to copy it. For Claude Code, set ' +
        'ANTHROPIC_CUSTOM_HEADERS="X-TPT-Token: <token>" (done automatically in new terminals).');
      return;
    }

    if (!isAllowedPath(req.url ?? '/')) {
      sendErrorJson(res, 404, `TPT: ${pathOnly(req.url ?? '/')} is not proxied`);
      return;
    }

    // Mark activity so quota polling knows the user is working
    recordActivity();

    // Hard budget stop — block request before any processing
    if (config.enabled && config.costBudget.hardStop) {
      if (config.costBudget.dailyLimitUsd > 0) {
        const spent = await getTodayCostUsd();
        if (spent >= config.costBudget.dailyLimitUsd) {
          sendErrorJson(res, 429,
            `TPT: Daily budget of $${config.costBudget.dailyLimitUsd.toFixed(2)} exceeded ` +
            `(spent $${spent.toFixed(4)} today). Increase tpt.costBudget.dailyLimitUsd or disable hardStop.`);
          return;
        }
      }
      if (config.costBudget.monthlyLimitUsd > 0) {
        const monthSpent = await getThisMonthCostUsd();
        if (monthSpent >= config.costBudget.monthlyLimitUsd) {
          sendErrorJson(res, 429,
            `TPT: Monthly budget of $${config.costBudget.monthlyLimitUsd.toFixed(2)} exceeded ` +
            `(spent $${monthSpent.toFixed(4)} this month). Increase tpt.costBudget.monthlyLimitUsd or disable hardStop.`);
          return;
        }
      }
    }

    // Bypass everything if master switch is off. A dry run also takes this path: it measures the
    // request below, then sends it exactly as the client wrote it.
    if (!config.enabled || config.dryRun) {
      let rawBody: string;
      try {
        rawBody = await readBody(req);
      } catch (e) {
        sendErrorJson(res, 413, `${e}`);
        return;
      }
      const upstream = resolveUpstreamUrl(config);
      const format = detectFormat(req.url ?? '/');

      // Detect streaming to avoid buffering SSE responses
      let isStreamingBypass = false;
      let bypassBody: Record<string, unknown> = {};
      try {
        bypassBody = JSON.parse(rawBody) as Record<string, unknown>;
        isStreamingBypass = bypassBody.stream === true;
      } catch { /* non-JSON body */ }
      const bypassExtraHeaders = grokConversationHeaders(config.upstreamProvider, bypassBody);

      // Measure only: the pipeline's result is not sent. It stores the per-stage counts for
      // TPT: Show Token Savings, and its body changes are discarded.
      if (config.enabled && config.dryRun && Array.isArray(bypassBody.messages)) {
        try {
          await runPipeline({
            method: req.method ?? 'POST',
            path: req.url ?? '/',
            headers: req.headers as Record<string, string | string[] | undefined>,
            // A fresh parse, so nothing the pipeline does can reach the body that is sent
            body: JSON.parse(rawBody) as Record<string, unknown>,
            format,
            sessionToken: sessionToken ?? '',
          });
        } catch (e) {
          log(`Dry run: measurement failed, the request is sent unchanged — ${e}`);
        }
      }

      if (isStreamingBypass) {
        await forwardStreamingRequest(
          upstream.baseUrl, upstream.apiKey,
          upstreamRequestPath(config.upstreamProvider, req.url ?? '/'), req.method ?? 'POST',
          req.headers, rawBody, format, config.upstreamProvider, res, bypassExtraHeaders
        );
        return;
      }

      try {
        const forwarded = await forwardRequest(
          upstream.baseUrl, upstream.apiKey,
          upstreamRequestPath(config.upstreamProvider, req.url ?? '/'), req.method ?? 'POST',
          req.headers, rawBody, format, config.upstreamProvider, bypassExtraHeaders
        );
        captureRateLimitHeaders(forwarded.headers as Record<string, string>);
        res.writeHead(forwarded.status, filterResponseHeaders(forwarded.headers));
        res.end(forwarded.body);
      } catch (e) {
        sendErrorJson(res, 502, `Upstream request failed: ${e}`);
      }
      return;
    }

    let rawBody: string;
    try {
      rawBody = await readBody(req);
    } catch (e) {
      sendErrorJson(res, 413, `${e}`);
      return;
    }

    // Requests without a body (e.g. GET /v1/models) are not JSON: pass them straight through
    if (rawBody.trim() === '') {
      const upstream = resolveUpstreamUrl(config);
      try {
        const forwarded = await forwardRequest(
          upstream.baseUrl, upstream.apiKey,
          upstreamRequestPath(config.upstreamProvider, req.url ?? '/'), req.method ?? 'GET',
          req.headers, '', detectFormat(req.url ?? '/'), config.upstreamProvider
        );
        res.writeHead(forwarded.status, filterResponseHeaders(forwarded.headers));
        res.end(forwarded.body);
      } catch (e) {
        sendErrorJson(res, 502, `Upstream request failed: ${e}`);
      }
      return;
    }

    const format = detectFormat(req.url ?? '/');
    let parsedBody: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      sendErrorJson(res, 400, 'Invalid JSON body');
      return;
    }

    // Hard stop, checked again with this request's own estimate. Concurrent requests otherwise all
    // pass the check above before any of them is recorded and overshoot the limit together.
    if (config.enabled && config.costBudget.hardStop && config.costBudget.dailyLimitUsd > 0) {
      const limit = config.costBudget.dailyLimitUsd;
      const estimate = estimateRequestCostUsd(parsedBody);
      const spent = await getTodayCostUsd();
      // Check and reserve with no await in between, so no other request can slip in between
      if (spent + inFlightUsd + estimate > limit) {
        sendErrorJson(res, 429,
          `TPT: this request would exceed the daily budget of $${limit.toFixed(2)} ` +
          `(spent $${spent.toFixed(4)} today, $${inFlightUsd.toFixed(4)} in flight).`);
        return;
      }
      reserveBudget(res, estimate);
    }

    const proxyReq: ProxyRequest = {
      method: req.method ?? 'POST',
      path: req.url ?? '/',
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: parsedBody,
      format,
      sessionToken: sessionToken!,
    };

    let pipelineResult;
    try {
      pipelineResult = await runPipeline(proxyReq);
    } catch (e) {
      log(`Pipeline error: ${e}`);
      sendErrorJson(res, 500, `TPT pipeline error: ${e}`);
      return;
    }

    // A translated request is the client's messages endpoint only: /v1/messages for an
    // Anthropic-format client, /v1/chat/completions for an OpenAI-format one
    const translating = pipelineResult.translated === true;
    const clientMessagesPath = format === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    if (translating && pathOnly(req.url ?? '/') !== clientMessagesPath) {
      sendErrorJson(res, 404, `TPT: ${pathOnly(req.url ?? '/')} is not translated for this provider`);
      return;
    }

    // Cache hit — return stored response directly
    if (pipelineResult.cachedResponse) {
      const tokensIn = countTokens(parsedBody as AnthropicRequest | OpenAIRequest);
      await recordRequest({
        model: (parsedBody as AnthropicRequest).model ?? 'unknown',
        tokensIn,
        tokensOut: 0,
        costUsd: 0,
        moduleActions: pipelineResult.moduleActions,
        cacheHit: true,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(pipelineResult.cachedResponse);
      return;
    }

    // The router may send this request to a different provider than the global setting
    const provider: UpstreamProvider = pipelineResult.overrideUpstream?.provider ?? config.upstreamProvider;
    // The format the upstream actually speaks, which is what its usage and stream events use
    const upstreamFormat: 'anthropic' | 'openai' = translating ? (format === 'anthropic' ? 'openai' : 'anthropic') : format;
    const upstreamPath = translating
      ? (upstreamFormat === 'openai' ? '/v1/chat/completions' : '/v1/messages')
      : upstreamRequestPath(provider, req.url ?? '/');
    // Set when the client asked for usage in the stream: the converted stream then ends with it
    const includeUsage = (parsedBody as { stream_options?: { include_usage?: unknown } }).stream_options?.include_usage === true;

    // Streaming path — pipe SSE chunks directly to the client
    const isStreaming = !!(pipelineResult.body as Record<string, unknown>).stream;
    if (isStreaming) {
      const upstream = pipelineResult.overrideUpstream ?? resolveUpstreamUrl(config);
      const outBody = JSON.stringify(pipelineResult.body);
      const tokensIn = countTokens(pipelineResult.body as AnthropicRequest | OpenAIRequest);
      const extraHeaders = grokConversationHeaders(provider, pipelineResult.body as Record<string, unknown>);
      try {
        const { accumulated, status } = await forwardStreamingRequest(
          upstream.baseUrl, upstream.apiKey,
          upstreamPath, req.method ?? 'POST',
          req.headers, outBody, format, provider, res, extraHeaders,
          !translating ? undefined
            : format === 'anthropic' ? new OpenAIStreamToAnthropic()
            : new AnthropicStreamToOpenAI(includeUsage)
        );
        // Prefer the provider's own counts; the local estimates are only a fallback
        const usage = readUpstreamUsage(accumulated, upstreamFormat, true);
        const billedIn = usage.inputTokens ?? tokensIn;
        const tokensOut = usage.outputTokens ?? estimateStreamingTokensOut(accumulated, upstreamFormat);
        const model = (pipelineResult.body as AnthropicRequest).model ?? 'unknown';
        await recordRequest({
          model,
          tokensIn: billedIn,
          tokensOut,
          costUsd: status === 200 ? getCostUsd(model, billedIn, tokensOut, cacheOf(usage)) : 0,
          moduleActions: pipelineResult.moduleActions,
          cacheHit: false,
          stageTokens: pipelineResult.stageTokens,
        });
        if (status === 200) {
          markConnected();
          if (config.silentEdit.enabled) {
            await handleSilentEditStreamResponse(accumulated, upstreamFormat);
          }
          checkBudget().catch(() => { /* ignore */ });
        }
      } catch (e) {
        log(`Streaming upstream error: ${e}`);
        sendErrorJson(res, 502, `Upstream streaming failed: ${e}`);
      }
      return;
    }

    // Non-streaming path
    const upstream = pipelineResult.overrideUpstream ?? resolveUpstreamUrl(config);
    const outBody = JSON.stringify(pipelineResult.body);
    const tokensIn = countTokens(pipelineResult.body as AnthropicRequest | OpenAIRequest);
    const nonStreamExtraHeaders = grokConversationHeaders(provider, pipelineResult.body as Record<string, unknown>);

    let forwarded;
    try {
      forwarded = await forwardRequest(
        upstream.baseUrl, upstream.apiKey,
        upstreamPath, req.method ?? 'POST',
        req.headers, outBody, format, provider, nonStreamExtraHeaders
      );
    } catch (e) {
      log(`Upstream error: ${e}`);
      sendErrorJson(res, 502, `Upstream request failed: ${e}`);
      return;
    }

    if (forwarded.status === 200) markConnected();

    // What the client receives: the upstream answer, converted back when the request was translated
    const clientBody = translating ? toClientFormat(format, forwarded.status, forwarded.body) : forwarded.body;

    // Store under the same key Token Shield looked up with (the client's request, post-Vault).
    // Responses that call a tool are tied to this turn and are never reused. The stored body is
    // the client's format, so a later cache hit can be returned as it is.
    if (config.tokenShield.enabled && forwarded.status === 200 && pipelineResult.cacheKey &&
        !responseHasToolCall(forwarded.body)) {
      await storeCachedResponse(
        pipelineResult.cacheKey.messages,
        clientBody,
        config.tokenShield,
        pipelineResult.cacheKey.scope
      );
    }

    // Silent Edit response interception
    let finalBody = clientBody;
    if (config.silentEdit.enabled && forwarded.status === 200) {
      finalBody = await handleSilentEditResponse(clientBody);
    }

    // Prefer the provider's own counts; the local estimates are only a fallback
    const usage = readUpstreamUsage(forwarded.body, upstreamFormat, false);
    const billedIn = usage.inputTokens ?? tokensIn;
    const tokensOut = usage.outputTokens ?? estimateOutputTokens(forwarded.body);
    await recordRequest({
      model: (pipelineResult.body as AnthropicRequest).model ?? 'unknown',
      tokensIn: billedIn,
      tokensOut,
      costUsd: getCostUsd((pipelineResult.body as AnthropicRequest).model ?? '', billedIn, tokensOut, cacheOf(usage)),
      moduleActions: pipelineResult.moduleActions,
      cacheHit: false,
      stageTokens: pipelineResult.stageTokens,
    });
    checkBudget().catch(() => { /* ignore */ });
    captureRateLimitHeaders(forwarded.headers as Record<string, string>);

    res.writeHead(forwarded.status, { 'content-type': 'application/json' });
    res.end(finalBody);
  };

  // A throw anywhere in the handler must answer the client, not leave the socket hanging
  server = http.createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      log(`Request handler error: ${e}`);
      if (!res.headersSent) {
        sendErrorJson(res, 500, `TPT proxy error: ${e}`);
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  const listen = (port: number) => new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(port, '127.0.0.1', () => {
      server!.off('error', reject);
      resolve();
    });
  });

  // The probe above can lose its port to another process before listen() runs; retry on the next one
  let port = await findFreePort(PREFERRED_PORT);
  for (let attempt = 0; ; attempt++) {
    try {
      await listen(port);
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EADDRINUSE' || attempt >= MAX_PORT_ATTEMPTS) {
        serverState = 'error';
        serverError = (err as Error).message;
        activePort = undefined;
        throw err;
      }
      port = await findFreePort(port + 1);
    }
  }

  activePort = port;
  serverState = 'running';
  log(`TPT proxy listening on http://127.0.0.1:${port}`);
  vscode.commands.executeCommand('setContext', 'tpt.proxyActive', true);

  // Terminals must point at the port actually bound, so inject only after listen succeeds
  await injectTerminalEnv(port);
}

// Sends GET /v1/models through the running proxy, the same route a client takes. Reports what
// the upstream answered, so a missing or wrong key shows up here instead of mid-session.
export function testProxyConnection(): Promise<{ ok: boolean; message: string }> {
  return new Promise((resolve) => {
    if (!activePort || !sessionToken) {
      resolve({ ok: false, message: 'The proxy is not running.' });
      return;
    }
    const req = http.request(
      { host: '127.0.0.1', port: activePort, path: '/v1/models', method: 'GET', headers: { 'x-tpt-token': sessionToken } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            resolve({ ok: true, message: `Upstream answered HTTP ${status}.` });
          } else {
            const detail = Buffer.concat(chunks).toString('utf8').slice(0, 200);
            resolve({ ok: false, message: `Upstream answered HTTP ${status}: ${detail}` });
          }
        });
      }
    );
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ ok: false, message: 'No answer within 15 seconds.' });
    });
    req.on('error', (e) => resolve({ ok: false, message: `Could not reach the proxy: ${e.message}` }));
    req.end();
  });
}

// Resolves once the listening socket is closed, so deactivate can wait for it
export function stopProxyServer(): Promise<void> {
  clearInterval(pricingTimer);
  pricingTimer = undefined;
  const srv = server;
  server = undefined;
  activePort = undefined;
  serverState = 'starting';
  serverError = undefined;

  return new Promise((resolve) => {
    if (!srv) {
      resolve();
      return;
    }
    srv.closeAllConnections();
    srv.close(() => {
      log('TPT proxy stopped');
      vscode.commands.executeCommand('setContext', 'tpt.proxyActive', false);
      resolve();
    });
  });
}

// Writes the proxy URL and token into terminal env. Failures are logged, not thrown: a window
// with no workspace folder must still start the proxy and its commands.
async function injectTerminalEnv(port: number): Promise<void> {
  const cfg = vscode.workspace.getConfiguration();
  const proxyUrl = `http://127.0.0.1:${port}`;
  const token = sessionToken!;

  const envPatch = {
    ANTHROPIC_BASE_URL: proxyUrl,
    // Claude Code reads this to add headers to every request, which is how it sends the token
    ANTHROPIC_CUSTOM_HEADERS: `X-TPT-Token: ${token}`,
    OPENAI_BASE_URL: `${proxyUrl}/v1`,
    TPT_TOKEN: token,
  };

  const previousPort = terminalState?.get<number>('tpt.terminalPort');
  try {
    for (const key of ['terminal.integrated.env.windows', 'terminal.integrated.env.linux', 'terminal.integrated.env.osx']) {
      const current = cfg.get<Record<string, string>>(key, {});
      await cfg.update(key, { ...current, ...envPatch }, vscode.ConfigurationTarget.Workspace);
    }
    terminalState?.update('tpt.terminalPort', port);
    // A terminal keeps the environment it was started with, so one opened before a port move
    // still points at the old proxy. Its shell cannot be updated from here.
    if (previousPort !== undefined && previousPort !== port) {
      vscode.window.showWarningMessage(
        `TPT moved to port ${port} (it was ${previousPort}). Terminals already open still point at the old port: close them and open new ones.`
      );
    }
  } catch (e) {
    log(`Could not write terminal environment (open a folder to enable it): ${e}`);
  }
}

// The upstream's answer in the client's format: Anthropic for an Anthropic-format request
// The upstream's answer in the client's format. An Anthropic-format client gets an Anthropic message
// (converted from OpenAI chat); an OpenAI-format client gets a chat completion (converted from Anthropic).
function toClientFormat(clientFormat: 'anthropic' | 'openai', status: number, body: string): string {
  if (clientFormat === 'openai') {
    if (status !== 200) return openAIErrorBody(body);
    try {
      return JSON.stringify(anthropicResponseToOpenAI(JSON.parse(body) as Record<string, unknown>));
    } catch {
      return openAIErrorBody(body);
    }
  }
  if (status !== 200) return anthropicErrorBody(body);
  try {
    return JSON.stringify(openAIResponseToAnthropic(JSON.parse(body) as Record<string, unknown>));
  } catch {
    return anthropicErrorBody(body);
  }
}

function estimateOutputTokens(responseBody: string): number {
  try {
    const parsed = JSON.parse(responseBody);
    if (parsed.usage?.output_tokens) return parsed.usage.output_tokens;
    if (parsed.usage?.completion_tokens) return parsed.usage.completion_tokens;
  } catch { /* ignore */ }
  return Math.ceil(responseBody.length / 4);
}

// Extract output token count from an accumulated SSE stream body.
// Scans from the end to find the usage event (most providers emit it last).
function estimateStreamingTokensOut(sseBody: string, format: 'anthropic' | 'openai'): number {
  const lines = sseBody.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      // Anthropic: message_delta event carries output_tokens in usage
      if (format === 'anthropic' && parsed.type === 'message_delta' && parsed.usage?.output_tokens) {
        return parsed.usage.output_tokens;
      }
      // OpenAI: some providers include usage in a final non-[DONE] chunk
      if (format === 'openai' && parsed.usage?.completion_tokens) {
        return parsed.usage.completion_tokens;
      }
    } catch { /* skip malformed event */ }
  }
  // Rough fallback: SSE overhead is significant so divide by more than plain JSON
  return Math.ceil(sseBody.length / 20);
}

// Cache counts from the provider's usage, in the shape the pricing code takes
function cacheOf(usage: { cacheReadTokens?: number; cacheWriteTokens?: number }): { read?: number; write?: number } {
  return { read: usage.cacheReadTokens, write: usage.cacheWriteTokens };
}

// Estimated cost of requests still in flight. Released when each response closes.
let inFlightUsd = 0;

function reserveBudget(res: http.ServerResponse, usd: number): void {
  inFlightUsd += usd;
  res.once('close', () => {
    inFlightUsd -= usd;
  });
}

// Upper-bound estimate: the prompt as counted locally, and the full max_tokens as output.
// A model with no known price estimates to 0, so the budget cannot stop it.
function estimateRequestCostUsd(body: unknown): number {
  const b = body as { model?: string; max_tokens?: number };
  const maxOut = typeof b.max_tokens === 'number' ? b.max_tokens : 4096;
  return getCostUsd(b.model ?? '', countTokens(body as AnthropicRequest | OpenAIRequest), maxOut);
}

let budgetAlertShownToday = '';

async function checkBudget(): Promise<void> {
  const cfg = getConfig();
  const limit = cfg.costBudget.dailyLimitUsd;
  if (!limit) return;

  // Local calendar day, the same day boundary getTodayCostUsd uses (UTC would reset mid-afternoon in some zones)
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (budgetAlertShownToday === todayKey) return;

  const spent = await getTodayCostUsd();
  if (spent >= limit) {
    budgetAlertShownToday = todayKey;
    vscode.window.showWarningMessage(
      `TPT: Daily spend limit of $${limit.toFixed(2)} reached — today's cost is $${spent.toFixed(4)}.`,
      'Open Dashboard'
    ).then((choice) => {
      if (choice === 'Open Dashboard') {
        vscode.commands.executeCommand('tpt.showDashboard');
      }
    });
  }
}
