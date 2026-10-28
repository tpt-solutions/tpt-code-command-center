# TPT Code Command Center — Task Checklist

## Phase 1 — Foundation (Complete)

- [x] Scaffold TypeScript VS Code extension (`package.json`, `tsconfig.json`, `src/extension.ts`)
- [x] Local HTTP proxy server — dynamic port binding starting at 7331
- [x] Session token security — random token per activation, required as `X-TPT-Token` header
- [x] Inject `ANTHROPIC_BASE_URL` into VS Code terminal environments (all platforms)
- [x] Pipeline middleware chain (`proxy/pipeline.ts`)
- [x] Status bar item — Green / Yellow / Red shield icon
- [x] Quick Pick toggle menu — per-module on/off + suite toggle
- [x] Token Ledger — `sql.js` database, token counting, cost estimation
- [x] WebView dashboard — stats, 7-day chart, module status

## Phase 2 — Modules (Complete)

- [x] **TPT Vault** — regex redaction (AWS, Stripe, GitHub PAT, JWT, .env, SSH keys, custom patterns)
- [x] **TPT Smart Context** — `web-tree-sitter` AST outline extraction for large file tool results
- [x] **TPT Token Shield** — SHA-256 hash-based exact-match prompt cache backed by `sql.js`
- [x] **TPT Memory Weaver** — conversation summarisation via Ollama → proxy LLM → extractive (configurable)
- [x] **TPT Router** — heuristic model/provider rewriting based on token count, keywords, file extensions
- [x] **TPT Silent Edit** — JSON edit schema injection + `WorkspaceEdit` API application
- [x] **TPT Forge** — GitHub-backed community config registry with Quick Pick browser
- [x] **TPT Terminal** — Output Channel live logs, verbose mode toggle

## Phase 3 — Developer Experience (Pending)

- [x] Add `.vscode/launch.json` — F5 Extension Development Host configuration
- [x] Add `.vscode/tasks.json` — build/watch tasks
- [x] Create `media/icon.png` — 128×128 marketplace icon (currently placeholder SVG only)
- [x] Add `.vscode/settings.json` example for Cline setup (base URL + `X-TPT-Token` header)
- [x] Write unit tests (`src/test/`) — Vault regex, hash normalisation, router rule matching
- [x] Add integration test — proxy pass-through with a mock upstream server

## Phase 4 — Streaming & Edge Cases (Pending)

- [x] Handle **streaming responses** (`stream: true`) — detects and routes to streaming path
- [x] Handle **Anthropic streaming** (`text/event-stream` SSE format)
- [x] Handle **OpenAI streaming** (`data: [DONE]` SSE format)
- [x] Token counting from streaming chunks (accumulate for ledger)
- [x] Silent Edit interception for streamed responses
- [x] Graceful proxy error page — consistent `sendErrorJson` helper with descriptive messages

## Phase 5 — Smart Context Enhancements (Pending)

- [x] Bundle tree-sitter language WASM files for TypeScript, JavaScript, Python, Go, Rust
  - These must ship with the extension (not fetched at runtime) for offline/air-gapped use
  - Add to `package.json` files array and `.vscodeignore` whitelist
- [x] Support outline extraction for additional languages (C#, Java, PHP, Ruby)
- [x] Detect file extension from tool call `path` argument rather than content heuristic

## Phase 6 — Router & Cost Tracking (Pending)

- [x] Seed Router with built-in default rules (`maxTokens: 2000` → `gpt-4o-mini`, code extensions → `gpt-4o`)
- [x] Pull live model pricing from OpenRouter API and cache locally (refresh daily)
- [x] Display per-model cost breakdown in the dashboard
- [x] Add "cost budget" alert — warn when daily spend exceeds a threshold

## Phase 7 — Forge Registry (Pending)

- [x] Create the `tpt-forge/registry` GitHub repository with `index.json` and example entries
- [x] Publish initial community configs:
  - [x] Default router rules set
  - [x] Common Vault patterns (internal company key formats)
  - [x] System prompt templates for Silent Edit schema

## Phase 8 — Packaging & Release (Pending)

- [x] Install `vsce` and run `vsce package` — verify `.vsix` builds cleanly
- [x] Test `.vsix` install on clean Windows machine
- [ ] Test `.vsix` install on macOS
- [ ] Test `.vsix` install on Linux
- [x] Create `media/icon.png` 128×128 and 256×256 versions
- [ ] Fill in `package.json` `publisher` field — register at https://marketplace.visualstudio.com/manage then update `"publisher"` in package.json
- [ ] Add marketplace screenshots to `media/` and reference them in README.md
- [ ] Publish to VS Code Marketplace via `vsce publish`
- [x] Tag v0.1.0 release on GitHub
- [x] Write `CHANGELOG.md` v0.1.0 entry

## Phase 9 — Future Ideas (Backlog)

- [x] Semantic cache upgrade — Ollama embedding similarity in Token Shield (opt-in via `tpt.tokenShield.semanticCache.*`); uses `nomic-embed-text` model, cosine similarity threshold configurable
- [x] Cline auto-configuration — `TPT: Auto-Configure Cline` command detects Cline extension and sets `cline.apiProvider`, `cline.openAiBaseUrl`, and `cline.openAiHeaders` automatically
- [x] Multi-workspace support — VS Code runs one extension host per window; module singletons are already window-scoped; `.tpt/` data path uses `workspaceFolders[0]` (inherently per-workspace)
- [x] Token budget per project — `tpt.costBudget.hardStop: true` rejects requests with HTTP 429 when daily limit is exceeded (existing `dailyLimitUsd` setting still controls the threshold)
- [x] Prompt diff view — `TPT: Show Prompt Diff` opens a side-by-side WebView comparing original client body vs post-pipeline body with module actions and router override listed
- [x] TPT Inspect command — `TPT: Inspect Last Request` dumps the processed body, module actions, and router override to the Output Channel for the most recent proxied request
- [x] Export ledger to CSV — `TPT: Export Ledger to CSV` prompts for a save path and writes all ledger rows as CSV

## Phase 10 — Prompt Caching Across Providers (Complete)

- [x] **TPT Prompt Cache** (`src/modules/promptCache.ts`) — injects Anthropic `cache_control: {type: 'ephemeral'}` breakpoints on the last system-prompt block and the second-to-last message, wired into the pipeline as step 5.5, gated on `tpt.promptCache.enabled` (default on) and Anthropic-format requests only
- [x] Status bar Quick Pick toggle + `TptConfig.promptCache.enabled` setting added
- [x] Grok conversation-routing header — `x-grok-conv-id` derived from the first message hash, sent on all Grok-bound requests (bypass, streaming, non-streaming paths) so xAI routes repeat turns to the same server and maximizes its automatic cache hit rate
- [x] Verified no code changes needed for OpenAI, DeepSeek, Qwen, or Kimi — all four cache automatically upstream (confirmed via provider docs, not just assumed)
- [x] Added GLM (Zhipu/Z.ai, `https://api.z.ai/api/paas/v4`) and MiMo (Xiaomi, `https://api.xiaomimimo.com/v1`) as supported `tpt.upstreamProvider` values — both are OpenAI-compatible with Bearer auth, no special-casing needed in `server.ts`; both cache automatically upstream with no proxy changes needed either
- [x] Added Mistral (`https://api.mistral.ai/v1`) as a supported `tpt.upstreamProvider` value — OpenAI-compatible with Bearer auth. Unlike GLM/MiMo, Mistral has **no automatic caching**: it requires a stable `prompt_cache_key` on requests sharing a prefix (64-token minimum cache block). Added `runMistralCacheKey` in `promptCache.ts`, wired into `pipeline.ts` as step 5.6, sets the key from the conversation's first message hash — same pattern as the Grok conv-id header
- [x] Setup wizard (`src/ui/setupWizard.ts`) updated — now offers all nine hosted providers (deepseek, qwen, kimi, grok, glm, mimo, mistral added alongside the original openrouter/anthropic/openai), not just five
- [ ] Manual verification pending: run a real multi-turn Anthropic conversation through the proxy with `tpt.terminal.verboseLogging` on and confirm `cache_read_input_tokens > 0` in the upstream response `usage` object on turn 2+ (unit tests only prove the markers are placed correctly, not that Anthropic honors them). Same verification needed for Mistral's `prompt_cache_key` — check the response `usage` object for a cache-hit field once a real key is available
- [ ] Groq and Google Gemini are strong next candidates (see chat) — both OpenAI-compatible, both cache automatically, neither added yet pending user confirmation
