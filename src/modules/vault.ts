import { AnthropicRequest, ContentBlock, Message, OpenAIRequest } from '../proxy/types';

// Prefixes of known secret formats are split across string literals so that
// GitHub secret scanning does not flag this source file as containing a leaked credential.
const p = (...parts: string[]) => new RegExp(parts.join(''), 'g');
const pi = (...parts: string[]) => new RegExp(parts.join(''), 'gi');

const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access key ID / secret
  p('AK', 'IA[0-9A-Z]{16}'),
  pi('(?:aws[_\\-]?secret[_\\-]?(?:access[_\\-]?)?key|aws[_\\-]?access[_\\-]?key[_\\-]?id)', '\\s*[:=]\\s*["\']?([A-Za-z0-9/+=]{20,})'),
  // Stripe secret / restricted key
  /sk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
  /rk_(?:live|test)_[0-9a-zA-Z]{24,}/g,
  // GitHub tokens: classic PAT, OAuth/app/refresh tokens, fine-grained PAT
  p('gh', '[pousr]_[A-Za-z0-9]{36,}'),
  p('github', '_pat_[A-Za-z0-9_]{82}'),
  // Anthropic and OpenAI keys
  p('\\bsk', '-ant-[A-Za-z0-9_\\-]{20,}'),
  p('\\bsk', '-[A-Za-z0-9_\\-]{32,}'),
  // Slack tokens and Google API keys
  p('xox', '[abposr]-[A-Za-z0-9-]{10,}'),
  p('AI', 'za[0-9A-Za-z_\\-]{35}'),
  // JWT (3-part base64url)
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  // HTTP Authorization bearer tokens, e.g. "Authorization: Bearer abc.def-123"
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/gi,
  // Generic key=value patterns — lookahead prevents catastrophic backtracking on long non-matching strings
  /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})(?=["'\s,\r\n]|$)/gi,
  // Private IPs in URLs
  /https?:\/\/(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})/g,
  // .env style secrets
  /^(?:SECRET|PASSWORD|PASSWD|PWD|TOKEN|KEY|PRIVATE)[_A-Z]*\s*=\s*.+$/gm,
  // Whole PEM private key block, body included (encrypted, RSA, EC, OPENSSH, PGP-less PKCS#8)
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // Header alone, for a truncated key with no END line
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

const REDACT_PLACEHOLDER = '[REDACTED]';

// Lightweight ReDoS guard: rejects patterns with nested quantifiers like (a+)+ or (a|a)*
// which are the most common source of catastrophic backtracking.
export function isSafeRegex(pattern: string): boolean {
  // Reject patterns with repeated groups that themselves contain quantifiers
  return !/\([^)]*[+*{][^)]*\)[+*{?]/.test(pattern) &&
         !/(\[.*?\]|\\?.)[+*]\)?[+*{]/.test(pattern);
}

// Accepts a leading "(?i)" as a case-insensitive flag, since JavaScript has no inline flags
export function compileCustomPattern(pattern: string): RegExp | undefined {
  let source = pattern;
  let flags = 'g';
  if (source.startsWith('(?i)')) {
    source = source.slice(4);
    flags += 'i';
  }
  try {
    return new RegExp(source, flags);
  } catch {
    return undefined;
  }
}

export interface VaultResult {
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  redacted: number;
}

export function runVault(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  customRegex: string[]
): VaultResult {
  const patterns = [...BUILTIN_PATTERNS];
  for (const pattern of customRegex) {
    // Patterns with catastrophic backtracking potential are skipped to prevent DoS
    if (!isSafeRegex(pattern)) continue;
    const re = compileCustomPattern(pattern);
    if (re) patterns.push(re);
  }

  let count = 0;

  // No size cap: a secret inside a large file read is still a secret, so long blocks are
  // scanned in full. The built-in patterns are linear; custom ones are filtered above.
  function redactText(text: string): string {
    let out = text;
    for (const re of patterns) {
      re.lastIndex = 0;
      const before = out;
      out = out.replace(re, REDACT_PLACEHOLDER);
      if (out !== before) count++;
    }
    return out;
  }

  // Tool inputs and tool results can carry secrets as nested strings, so walk the value
  function redactValue(value: unknown): unknown {
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map(redactValue);
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v);
      return out;
    }
    return value;
  }

  function redactBlock(block: ContentBlock): ContentBlock {
    const b = block as unknown as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      return { ...block, text: redactText(b.text) };
    }
    if (b.type === 'tool_use') {
      // The model can echo a secret it read into a tool argument
      return { ...block, input: redactValue(b.input) } as unknown as ContentBlock;
    }
    if (b.type === 'tool_result') {
      // Tool results carry file content: either a bare string or an array of text blocks
      const content = b.content;
      if (typeof content === 'string') return { ...block, content: redactText(content) } as unknown as ContentBlock;
      if (Array.isArray(content)) {
        return { ...block, content: content.map((c) => redactBlock(c as ContentBlock)) } as unknown as ContentBlock;
      }
    }
    return block;
  }

  function redactMessage(msg: Message): Message {
    let next: Message = msg;
    if (typeof msg.content === 'string') {
      next = { ...msg, content: redactText(msg.content) };
    } else if (Array.isArray(msg.content)) {
      next = { ...msg, content: msg.content.map((block: ContentBlock) => redactBlock(block)) };
    }

    // OpenAI-format tool calls carry the arguments as a JSON string
    const toolCalls = (msg as unknown as Record<string, unknown>).tool_calls;
    if (Array.isArray(toolCalls)) {
      const redactedCalls = toolCalls.map((call) => {
        const c = call as Record<string, unknown>;
        const fn = c.function as Record<string, unknown> | undefined;
        if (!fn || typeof fn.arguments !== 'string') return call;
        return { ...c, function: { ...fn, arguments: redactText(fn.arguments) } };
      });
      next = { ...next, tool_calls: redactedCalls } as unknown as Message;
    }
    return next;
  }

  const b = body as AnthropicRequest | OpenAIRequest;
  let messages = b.messages ?? [];
  messages = messages.map(redactMessage);

  let result: AnthropicRequest | OpenAIRequest = { ...b, messages };

  // Redact system prompt
  if ('system' in result && result.system) {
    if (typeof result.system === 'string') {
      result = { ...result, system: redactText(result.system) };
    } else if (Array.isArray(result.system)) {
      result = {
        ...result,
        system: result.system.map((block) =>
          block.type === 'text' ? { ...block, text: redactText(block.text ?? '') } : block
        ),
      };
    }
  }

  return { body: result, redacted: count };
}
