// Token counts as the provider reports them. The ledger prefers these over the local chars/4
// estimate, because they are what the provider bills. Missing or malformed usage yields
// undefined fields, and the caller falls back to the estimate.

export interface UpstreamUsage {
  // Total prompt tokens, cache reads and writes included
  inputTokens?: number;
  outputTokens?: number;
  // The part of the prompt served from cache, and the part written to it (Anthropic)
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// Anthropic reports cache reads and writes separately from input_tokens. All three are prompt
// tokens, so they are summed. The ledger does not model the cache discount yet, so this is the
// full-price figure for the prompt.
function anthropicPromptTokens(u: Record<string, unknown>): number | undefined {
  const base = num(u.input_tokens);
  if (base === undefined) return undefined;
  return base + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
}

// Applies the Anthropic cache counts from a usage object to the result
function anthropicCache(u: Record<string, unknown>, out: UpstreamUsage): void {
  const read = num(u.cache_read_input_tokens);
  const write = num(u.cache_creation_input_tokens);
  if (read !== undefined) out.cacheReadTokens = read;
  if (write !== undefined) out.cacheWriteTokens = write;
}

export function readUpstreamUsage(
  body: string,
  format: 'anthropic' | 'openai',
  streamed: boolean
): UpstreamUsage {
  const out: UpstreamUsage = {};

  if (!streamed) {
    let parsed: { usage?: Record<string, unknown> } | undefined;
    try { parsed = JSON.parse(body); } catch { return out; }
    const u = parsed?.usage;
    if (!u) return out;
    if (format === 'anthropic') {
      out.inputTokens = anthropicPromptTokens(u);
      out.outputTokens = num(u.output_tokens);
      anthropicCache(u, out);
    } else {
      out.inputTokens = num(u.prompt_tokens);
      out.outputTokens = num(u.completion_tokens);
    }
    return out;
  }

  // Streamed: usage arrives in SSE events. Anthropic sends the input count in message_start and
  // a running output count in message_delta (the last one wins). OpenAI sends usage in a final
  // chunk, and only when the client asked for it.
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let ev: { type?: string; message?: { usage?: Record<string, unknown> }; usage?: Record<string, unknown> };
    try { ev = JSON.parse(data); } catch { continue; }

    if (format === 'anthropic') {
      if (ev.type === 'message_start' && ev.message?.usage) {
        out.inputTokens = anthropicPromptTokens(ev.message.usage) ?? out.inputTokens;
        anthropicCache(ev.message.usage, out);
      }
      if (ev.type === 'message_delta' && ev.usage) {
        out.outputTokens = num(ev.usage.output_tokens) ?? out.outputTokens;
      }
    } else if (ev.usage) {
      out.inputTokens = num(ev.usage.prompt_tokens) ?? out.inputTokens;
      out.outputTokens = num(ev.usage.completion_tokens) ?? out.outputTokens;
    }
  }
  return out;
}
