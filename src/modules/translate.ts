// Anthropic Messages <-> OpenAI chat, for a request from an Anthropic-format client (Claude Code)
// that is routed to an OpenAI-compatible provider. The answer is converted back into Anthropic's
// shape, so the client never sees the difference.
//
// Translated: system prompts, text and image parts, tool definitions, tool_choice, tool_use and
// tool_result, stop reasons, usage, and streamed text and tool calls.
// Not translated: thinking blocks, cache_control and citations, which have no OpenAI equivalent.

type Json = Record<string, unknown>;

function isType(type: string): (b: Json) => boolean {
  return (b) => b.type === type;
}

function systemText(system: unknown): string | undefined {
  if (typeof system === 'string') return system || undefined;
  if (!Array.isArray(system)) return undefined;
  const text = (system as Json[]).filter(isType('text')).map((b) => String(b.text ?? '')).join('\n');
  return text || undefined;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return (content as Json[]).filter(isType('text')).map((b) => String(b.text ?? '')).join('\n');
}

// Text and image parts of a user turn, in OpenAI's content-part shape
function userParts(blocks: Json[]): Json[] {
  const parts: Json[] = [];
  for (const b of blocks) {
    if (b.type === 'text') {
      parts.push({ type: 'text', text: String(b.text ?? '') });
    } else if (b.type === 'image') {
      const source = (b.source ?? {}) as Json;
      const url = source.type === 'base64'
        ? `data:${String(source.media_type ?? 'image/png')};base64,${String(source.data ?? '')}`
        : String(source.url ?? '');
      if (url) parts.push({ type: 'image_url', image_url: { url } });
    }
  }
  return parts;
}

function toolChoice(choice: unknown): unknown {
  if (!choice || typeof choice !== 'object') return undefined;
  const c = choice as Json;
  switch (c.type) {
    case 'auto': return 'auto';
    case 'any': return 'required';
    case 'none': return 'none';
    case 'tool': return { type: 'function', function: { name: String(c.name) } };
    default: return undefined;
  }
}

// Anthropic request body -> OpenAI chat request body
export function anthropicRequestToOpenAI(body: Json): Json {
  const messages: Json[] = [];
  const system = systemText(body.system);
  if (system) messages.push({ role: 'system', content: system });

  for (const msg of (body.messages as Json[] | undefined) ?? []) {
    const role = String(msg.role);
    if (typeof msg.content === 'string') {
      messages.push({ role, content: msg.content });
      continue;
    }
    const blocks = Array.isArray(msg.content) ? (msg.content as Json[]) : [];

    if (role === 'assistant') {
      const text = blocks.filter(isType('text')).map((b) => String(b.text ?? '')).join('');
      const toolCalls = blocks.filter(isType('tool_use')).map((b) => ({
        id: String(b.id),
        type: 'function',
        function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) },
      }));
      const out: Json = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) out.tool_calls = toolCalls;
      messages.push(out);
      continue;
    }

    // A user turn: each tool_result answers an earlier tool call and becomes its own tool message,
    // placed before whatever the user wrote in the same turn
    for (const b of blocks.filter(isType('tool_result'))) {
      messages.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: toolResultText(b.content) });
    }
    const parts = userParts(blocks);
    if (parts.length === 1 && parts[0].type === 'text') {
      messages.push({ role: 'user', content: parts[0].text });
    } else if (parts.length > 0) {
      messages.push({ role: 'user', content: parts });
    }
  }

  const out: Json = { model: body.model, messages, stream: body.stream === true };
  if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length > 0) out.stop = body.stop_sequences;
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = (body.tools as Json[]).map((t) => ({
      type: 'function',
      function: {
        name: String(t.name),
        description: String(t.description ?? ''),
        parameters: t.input_schema ?? { type: 'object', properties: {} },
      },
    }));
  }
  const choice = toolChoice(body.tool_choice);
  if (choice !== undefined) out.tool_choice = choice;
  // Ask for usage in the stream, so the ledger gets the provider's counts
  if (out.stream) out.stream_options = { include_usage: true };
  return out;
}

export function stopReasonFromOpenAI(finish: unknown, sawToolCalls: boolean): string {
  switch (finish) {
    case 'length': return 'max_tokens';
    case 'tool_calls':
    case 'function_call': return 'tool_use';
    default: return sawToolCalls ? 'tool_use' : 'end_turn';
  }
}

function parseArguments(raw: unknown): Json {
  if (typeof raw !== 'string') return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Json) : {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Json) : {};
  } catch {
    return {};
  }
}

// OpenAI chat response (non-streamed) -> Anthropic message
export function openAIResponseToAnthropic(body: Json): Json {
  const choice = ((body.choices as Json[] | undefined) ?? [])[0] ?? {};
  const message = (choice.message ?? {}) as Json;
  const content: Json[] = [];
  if (typeof message.content === 'string' && message.content) {
    content.push({ type: 'text', text: message.content });
  }
  const calls = (message.tool_calls as Json[] | undefined) ?? [];
  for (const call of calls) {
    const fn = (call.function ?? {}) as Json;
    content.push({ type: 'tool_use', id: String(call.id), name: String(fn.name ?? ''), input: parseArguments(fn.arguments) });
  }
  const usage = (body.usage ?? {}) as Json;
  return {
    id: body.id ? String(body.id) : 'msg_tpt',
    type: 'message',
    role: 'assistant',
    model: String(body.model ?? ''),
    content,
    stop_reason: stopReasonFromOpenAI(choice.finish_reason, calls.length > 0),
    stop_sequence: null,
    usage: {
      input_tokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
    },
  };
}

// An upstream error in Anthropic's error shape, so the client's error handling works
export function anthropicErrorBody(body: string): string {
  let message: unknown = body;
  try {
    const parsed = JSON.parse(body) as Json;
    const err = parsed.error as unknown;
    message = (err && typeof err === 'object' ? (err as Json).message : err) ?? parsed.message ?? body;
  } catch { /* not JSON: keep the raw text */ }
  return JSON.stringify({
    type: 'error',
    error: { type: 'api_error', message: typeof message === 'string' ? message : JSON.stringify(message) },
  });
}

function sse(event: string, payload: Json): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

// Converts an OpenAI chat stream into an Anthropic message stream, one chunk at a time.
// Upstream chunks can split lines anywhere, so complete lines are buffered until their newline.
export class OpenAIStreamToAnthropic {
  private buffer = '';
  private started = false;
  private finished = false;
  private id = 'msg_tpt';
  private model = '';
  private nextBlock = 0;
  private textBlock: number | undefined;
  private toolBlocks = new Map<number, number>();
  private openBlocks = new Set<number>();
  private stopReason: string | undefined;
  private sawToolCalls = false;
  private outputTokens = 0;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '');
      this.buffer = this.buffer.slice(newline + 1);
      out += this.handleLine(line);
    }
    return out;
  }

  // Call once when the upstream stream has ended
  end(): string {
    let out = '';
    const rest = this.buffer.trim();
    this.buffer = '';
    if (rest) out += this.handleLine(rest);
    return out + this.finish();
  }

  private handleLine(line: string): string {
    if (!line.startsWith('data:')) return '';
    const data = line.slice(5).trim();
    if (!data) return '';
    if (data === '[DONE]') return this.finish();

    let ev: Json;
    try { ev = JSON.parse(data) as Json; } catch { return ''; }

    if (ev.id) this.id = String(ev.id);
    if (ev.model) this.model = String(ev.model);
    let out = this.start();

    const usage = ev.usage as Json | undefined;
    if (usage && typeof usage.completion_tokens === 'number') {
      this.outputTokens = usage.completion_tokens;
    }

    const choice = ((ev.choices as Json[] | undefined) ?? [])[0] as Json | undefined;
    if (!choice) return out;
    const delta = (choice.delta ?? {}) as Json;
    if (typeof delta.content === 'string' && delta.content) out += this.text(delta.content);
    for (const call of (delta.tool_calls as Json[] | undefined) ?? []) out += this.toolDelta(call);
    if (choice.finish_reason) this.stopReason = stopReasonFromOpenAI(choice.finish_reason, this.sawToolCalls);
    return out;
  }

  private start(): string {
    if (this.started) return '';
    this.started = true;
    return sse('message_start', {
      type: 'message_start',
      message: {
        id: this.id,
        type: 'message',
        role: 'assistant',
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    });
  }

  private closeText(): string {
    if (this.textBlock === undefined) return '';
    const index = this.textBlock;
    this.textBlock = undefined;
    return this.stopBlock(index);
  }

  private stopBlock(index: number): string {
    this.openBlocks.delete(index);
    return sse('content_block_stop', { type: 'content_block_stop', index });
  }

  private text(value: string): string {
    let out = '';
    if (this.textBlock === undefined) {
      this.textBlock = this.nextBlock++;
      this.openBlocks.add(this.textBlock);
      out += sse('content_block_start', {
        type: 'content_block_start',
        index: this.textBlock,
        content_block: { type: 'text', text: '' },
      });
    }
    return out + sse('content_block_delta', {
      type: 'content_block_delta',
      index: this.textBlock,
      delta: { type: 'text_delta', text: value },
    });
  }

  private toolDelta(call: Json): string {
    const key = Number(call.index ?? 0);
    const fn = (call.function ?? {}) as Json;
    let out = '';
    let index = this.toolBlocks.get(key);
    if (index === undefined) {
      out += this.closeText();
      index = this.nextBlock++;
      this.toolBlocks.set(key, index);
      this.openBlocks.add(index);
      this.sawToolCalls = true;
      out += sse('content_block_start', {
        type: 'content_block_start',
        index,
        content_block: {
          type: 'tool_use',
          id: String(call.id ?? `toolu_${index}`),
          name: String(fn.name ?? ''),
          input: {},
        },
      });
    }
    if (typeof fn.arguments === 'string' && fn.arguments) {
      out += sse('content_block_delta', {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json: fn.arguments },
      });
    }
    return out;
  }

  private finish(): string {
    if (this.finished) return '';
    this.finished = true;
    let out = this.start();
    out += this.closeText();
    for (const index of [...this.openBlocks].sort((a, b) => a - b)) out += this.stopBlock(index);
    out += sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: this.stopReason ?? (this.sawToolCalls ? 'tool_use' : 'end_turn'), stop_sequence: null },
      usage: { output_tokens: this.outputTokens },
    });
    out += sse('message_stop', { type: 'message_stop' });
    return out;
  }
}
