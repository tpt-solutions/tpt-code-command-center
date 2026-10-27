import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPromptCache, countExistingBreakpoints } from '../modules/promptCache';
import { AnthropicRequest } from '../proxy/types';

function body(extra: Partial<AnthropicRequest> = {}): AnthropicRequest {
  return {
    model: 'claude-sonnet-5-5',
    max_tokens: 100,
    system: 'stable system prompt',
    messages: [
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'an answer' },
      { role: 'user', content: 'follow-up' },
    ],
    ...extra,
  } as AnthropicRequest;
}

test('runPromptCache: marks the system prompt and the second-to-last message', () => {
  const result = runPromptCache(body());
  assert.equal(result.breakpoints, 2);
  assert.match(JSON.stringify(result.body), /"cache_control"/);
});

test('runPromptCache: never exceeds four breakpoints when the client already placed some', () => {
  const existing = {
    system: [
      { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'c', cache_control: { type: 'ephemeral' } },
    ],
  } as unknown as Partial<AnthropicRequest>;
  const result = runPromptCache(body(existing));
  // Three already present: only one more may be added
  assert.equal(countExistingBreakpoints(result.body), 4);
  assert.equal(result.breakpoints, 1);
});

test('runPromptCache: adds nothing when the limit is already reached', () => {
  const full = {
    system: [
      { type: 'text', text: 'a', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'b', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'c', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'd', cache_control: { type: 'ephemeral' } },
    ],
  } as unknown as Partial<AnthropicRequest>;
  const result = runPromptCache(body(full));
  assert.equal(result.breakpoints, 0);
});

test('runPromptCache: skips a thinking block and marks the last text block of the target message', () => {
  const messages = [
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'visible answer' },
        { type: 'thinking', thinking: 'internal reasoning', signature: 'sig' },
      ],
    },
    { role: 'user', content: 'next' },
  ] as unknown as AnthropicRequest['messages'];
  const result = runPromptCache(body({ system: undefined, messages }));
  const target = (result.body.messages[1].content as Array<Record<string, unknown>>);
  assert.equal(target[0].cache_control !== undefined, true);
  assert.equal(target[1].cache_control, undefined);
});

test('runPromptCache: an empty text block is not marked', () => {
  const messages = [
    { role: 'user', content: 'q' },
    { role: 'assistant', content: [{ type: 'text', text: '   ' }] },
    { role: 'user', content: 'next' },
  ] as unknown as AnthropicRequest['messages'];
  const result = runPromptCache(body({ system: undefined, messages }));
  assert.equal(result.breakpoints, 0);
});
