export interface ProxyRequest {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>;
  format: 'anthropic' | 'openai';
  sessionToken: string;
}

// Anthropic Messages API shape (simplified)
export interface AnthropicRequest {
  model: string;
  messages: Message[];
  system?: string | SystemBlock[];
  max_tokens?: number;
  tools?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
}

// OpenAI Chat Completions shape (simplified)
export interface OpenAIRequest {
  model: string;
  messages: Message[];
  max_tokens?: number;
  tools?: unknown[];
  stream?: boolean;
  prompt_cache_key?: string;
  [key: string]: unknown;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
  cache_control?: { type: 'ephemeral'; ttl?: '5m' | '1h' };
  [key: string]: unknown;
}
