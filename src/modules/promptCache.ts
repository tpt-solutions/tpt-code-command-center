import { AnthropicRequest, ContentBlock, Message, OpenAIRequest, SystemBlock } from '../proxy/types';
import { hashString } from '../utils/hash';

const CACHE_CONTROL: { type: 'ephemeral' } = { type: 'ephemeral' };

// Anthropic accepts at most four cache_control breakpoints per request; a fifth is a 400
const MAX_BREAKPOINTS = 4;

export interface PromptCacheResult {
  body: AnthropicRequest;
  breakpoints: number;
}

// Counts breakpoints the client already placed (on system, messages or tools)
export function countExistingBreakpoints(body: unknown): number {
  return (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
}

// Only text blocks are cacheable. Thinking blocks are rejected with cache_control, and an
// empty text block is rejected too. A block the client already marked is skipped, so the
// breakpoint goes to a new position instead of being spent on one that is already cached.
function lastCacheableIndex(blocks: Array<{ type?: string; text?: string; cache_control?: unknown }>): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.cache_control !== undefined) continue;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') return i;
  }
  return -1;
}

// Marks the last cacheable block of the system prompt and of the second-to-last message as
// cacheable, so Anthropic's native prompt caching discounts the stable prefix on every turn
// after the first. Below-minimum-length blocks are silently ignored by the API.
export function runPromptCache(body: AnthropicRequest): PromptCacheResult {
  let breakpoints = 0;
  let result = body;
  let remaining = MAX_BREAKPOINTS - countExistingBreakpoints(body);
  if (remaining <= 0) return { body, breakpoints: 0 };

  if (body.system && remaining > 0) {
    const systemBlocks: SystemBlock[] =
      typeof body.system === 'string' ? [{ type: 'text', text: body.system }] : [...body.system];
    const idx = lastCacheableIndex(systemBlocks);
    if (idx >= 0) {
      systemBlocks[idx] = { ...systemBlocks[idx], cache_control: CACHE_CONTROL };
      result = { ...result, system: systemBlocks };
      breakpoints++;
      remaining--;
    }
  }

  if (Array.isArray(body.messages) && body.messages.length >= 2 && remaining > 0) {
    const targetIdx = body.messages.length - 2;
    const target = body.messages[targetIdx];
    const blocks: ContentBlock[] =
      typeof target.content === 'string' ? [{ type: 'text', text: target.content }] : Array.isArray(target.content) ? [...target.content] : [];
    const idx = lastCacheableIndex(blocks as Array<{ type?: string; text?: string }>);
    if (idx >= 0) {
      blocks[idx] = { ...blocks[idx], cache_control: CACHE_CONTROL } as ContentBlock;
      const messages: Message[] = [...result.messages];
      messages[targetIdx] = { ...target, content: blocks };
      result = { ...result, messages };
      breakpoints++;
    }
  }

  return { body: result, breakpoints };
}

export interface MistralCacheKeyResult {
  body: OpenAIRequest;
  applied: boolean;
}

// Mistral has no automatic caching — it requires a stable `prompt_cache_key` on
// requests that share a prefix. Derived from the first non-system message so it
// stays the same across turns of the same conversation.
export function runMistralCacheKey(body: OpenAIRequest): MistralCacheKeyResult {
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return { body, applied: false };
  }
  const first = body.messages.find((m) => m.role !== 'system') ?? body.messages[0];
  const key = `tpt-${hashString(JSON.stringify(first.content)).slice(0, 32)}`;
  return { body: { ...body, prompt_cache_key: key }, applied: true };
}
