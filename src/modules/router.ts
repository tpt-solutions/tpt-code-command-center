import { AnthropicRequest, ContentBlock, Message, OpenAIRequest } from '../proxy/types';
import { RouterRule, UpstreamProvider, getConfig, isUpstreamProvider, resolveUpstreamUrl } from '../utils/config';

export interface RouteOverride {
  baseUrl: string;
  apiKey: string;
  model?: string;
  provider: UpstreamProvider;
}

// Anthropic Messages format for the anthropic provider, OpenAI chat format for everything else
export function providerFormat(provider: UpstreamProvider): 'anthropic' | 'openai' {
  return provider === 'anthropic' ? 'anthropic' : 'openai';
}

// Characters a block contributes to the token estimate. Tool inputs and tool results
// are part of the context sent upstream, so they count the same as text.
function blockChars(block: ContentBlock): number {
  const b = block as unknown as Record<string, unknown>;
  if (b.type === 'text' && typeof b.text === 'string') return b.text.length;
  if (b.type === 'tool_use') return JSON.stringify(b.input ?? {}).length;
  if (b.type === 'tool_result') {
    return typeof b.content === 'string' ? b.content.length : JSON.stringify(b.content ?? '').length;
  }
  return 0;
}

export function estimateTokensInMessages(messages: Message[]): number {
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') chars += msg.content.length;
    else if (Array.isArray(msg.content)) {
      for (const b of msg.content as ContentBlock[]) chars += blockChars(b);
    }
  }
  return Math.ceil(chars / 4);
}

// Human-written text only. Tool results are file and command output, so keyword rules
// must not match against them (an "error" in a log would otherwise trigger routing).
function userText(msg: Message): string {
  if (typeof msg.content === 'string') return msg.content;
  if (!Array.isArray(msg.content)) return '';
  return (msg.content as ContentBlock[])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

export function getLastUserContent(messages: Message[]): string {
  // Walk back past tool-result-only user turns to the last message the user actually typed
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'user') continue;
    const text = userText(messages[i]);
    if (text) return text;
  }
  return '';
}

export function getExtensionsInMessages(messages: Message[]): string[] {
  const exts = new Set<string>();
  // Extension must end at whitespace, punctuation or end of line, so "e.g." and "file.ts\n" are handled
  const re = /\.([a-zA-Z0-9]+)(?=[\s"'`,;:)\]}]|$)/gm;
  for (const msg of messages) {
    // Skip tool results: they echo file contents and would add extensions from code
    const parts: string[] = [];
    if (typeof msg.content === 'string') parts.push(msg.content);
    else if (Array.isArray(msg.content)) {
      for (const b of msg.content as ContentBlock[]) {
        if (b.type === 'tool_result') continue;
        parts.push(typeof b.text === 'string' ? b.text : JSON.stringify(b));
      }
    }
    for (const text of parts) {
      let m: RegExpExecArray | null;
      re.lastIndex = 0;
      while ((m = re.exec(text)) !== null) {
        exts.add(m[1].toLowerCase());
      }
    }
  }
  return [...exts];
}

// Sensible defaults used when the router is enabled but the user has no custom rules.
// Order matters (first match wins). Code-heavy contexts come first: otherwise the short-prompt
// rule below catches every small request and the coding model is never chosen.
export const BUILTIN_ROUTER_RULES: RouterRule[] = [
  // Code-heavy contexts — route to a capable coding model
  {
    match: { extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'cs'] },
    model: 'openai/gpt-4o',
    provider: 'openrouter',
  },
  // Short prompts don't need a frontier model — route to a cheaper fast model
  { match: { maxTokens: 2000 }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
];

function hasCriteria(rule: RouterRule): boolean {
  const m = rule.match ?? {};
  return m.maxTokens !== undefined || !!m.keywords?.length || !!m.extensions?.length;
}

// `format` is the API format of the incoming request. A rule that would send a request
// to a provider speaking the other format is skipped, because the body is not translated.
export function runRouter(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  rules: RouterRule[],
  format?: 'anthropic' | 'openai'
): RouteOverride | undefined {
  const messages = (body as AnthropicRequest).messages ?? [];
  const tokenCount = estimateTokensInMessages(messages);
  const userContent = getLastUserContent(messages).toLowerCase();
  const extensions = getExtensionsInMessages(messages);

  // Use built-in defaults when the user hasn't configured any rules
  const effectiveRules = rules.length > 0 ? rules : BUILTIN_ROUTER_RULES;
  const config = getConfig();

  for (const rule of effectiveRules) {
    const { match, model, provider } = rule;

    // An unknown provider would fall through to OpenRouter and send that key; a rule with
    // no criteria would catch every request. Both are configuration mistakes: skip them.
    if (!isUpstreamProvider(provider) || !hasCriteria(rule)) continue;
    if (format && providerFormat(provider) !== format) continue;

    let matched = true;
    if (match.maxTokens !== undefined && tokenCount > match.maxTokens) {
      matched = false;
    }
    if (matched && match.keywords?.length) {
      matched = match.keywords.some((kw) => userContent.includes(kw.toLowerCase()));
    }
    if (matched && match.extensions?.length) {
      matched = match.extensions.some((ext) => extensions.includes(ext.toLowerCase()));
    }

    if (matched) {
      const overrideConfig = { ...config, upstreamProvider: provider };
      const { baseUrl, apiKey } = resolveUpstreamUrl(overrideConfig);
      return { baseUrl, apiKey, model, provider };
    }
  }

  return undefined;
}
