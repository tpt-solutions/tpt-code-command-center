import * as crypto from 'crypto';

/**
 * Builds a cache key for a request. `scope` carries everything that changes the
 * response besides the messages (model, system prompt, tools, format, sampling
 * params). Content is hashed exactly as sent: case and whitespace are significant
 * (code, diffs and Python indentation depend on them).
 */
export function hashPrompt(messages: unknown[], scope: Record<string, unknown> = {}): string {
  const normalised = JSON.stringify({ scope, messages });
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}
