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

## Phase 11 — Review Findings: Bugs & Security (In progress)

Source: platform review (proxy core, modules, adoption). Items marked (verified) were confirmed in code. Code changes are unit-tested (`npm test`: 137 passing, `npm run lint` clean); live behaviour still needs the checks in Phase 14.

### Blockers
- [x] **Router model never applied** (verified) — pipeline sets `body.model` from the route; ledger and cost use the routed model
- [x] **Routed provider auth/path** — auth style, API path and `x-grok-conv-id` follow the routed provider. Cross-format routes (Anthropic body ↔ OpenAI-compatible provider) are skipped instead of sent untranslated; a translator is still open (Phase 13)
- [x] **Claude Code cannot authenticate** (verified) — `ANTHROPIC_CUSTOM_HEADERS=X-TPT-Token: <token>` injected into terminals after the port is bound. Confirm in a live Claude Code session (Phase 14)
- [x] **Silent Edit path traversal** — edits limited to the workspace root (absolute and `..` paths rejected), line ranges validated, `applyEdit` failure logged
- [x] **Silent Edit confirmation** — proposals show an Apply / Discard prompt; nothing is written until Apply. Edits stay unsaved so you can review them
- [x] **Token Shield cache key** — key covers model, system, tools, tool_choice, temperature, max_tokens and API format; case and whitespace are significant; entries expire after 24 h; responses containing tool calls are never cached
- [x] **Token Shield lookup/store mismatch** — store uses the same post-Vault request snapshot as lookup
- [x] **Memory Weaver orphans tool pairs** — window extends back so a tool result always keeps its `tool_use`; token estimate counts tool blocks; corrupt `memory.json` is recovered and writes are atomic
- [x] **Vault gaps** — array-form `tool_result`, `tool_use` input and OpenAI `tool_calls` are scanned; `Authorization: Bearer`, `gho_/ghs_/ghu_/ghr_`, `sk-ant-`, `sk-`, `xox*`, `AIza` and full PEM blocks are covered; the 200 KB fail-open skip is removed
- [x] **Forge built-in vault patterns invalid** — the vault accepts a leading `(?i)` as the `i` flag
- [ ] **Forge installs never consumed** — `.tpt/forge/` is written but never read; `forge.autoUpdate` does nothing

### Robustness
- [x] Request handler wrapped — a throw answers 500 instead of hanging the socket
- [x] Streaming: upstream aborted when the client disconnects; backpressure respected; idle timeouts; mid-stream cut-off recorded as 502. [ ] Accumulated stream buffer is still uncapped
- [x] Bodyless requests (e.g. `GET /v1/models`) passed through instead of 400. `/v1/v1` doubling for OpenAI-format requests fixed (client and provider base URLs both end in `/v1`). `/v1/messages/count_tokens` was already detected as Anthropic
- [x] Start-up: terminal-env failure no longer aborts the proxy; env is written after the port is bound (no stale port after fallback); commands register before the proxy starts, so a failed start keeps them working
- [x] Bind and advertise `127.0.0.1` instead of `localhost`
- [x] `findFreePort` bounded and retries only on EADDRINUSE; retries after a lost race; `stopProxyServer` drops open connections and `deactivate` awaits the close; pricing refreshes hourly
- [ ] Hard budget stop is racy: concurrent requests can pass the check before their spend is recorded. (Bypass when `tpt.enabled` is false is by design: disabled means pass-through.) [x] Alert day now uses the local calendar day. [ ] 7-day chart still buckets by UTC day
- [x] Concurrent first-call init race fixed in Token Shield `getDb()` and the ledger
- [ ] Ledger: debounced writes (still a full synchronous export per request); multi-window overwrite. [x] Atomic writes (temp file + rename). [x] CSV quote escaping and formula-injection guard. [x] Read-only and virtual workspaces no longer throw
- [x] `sql.js` path checked by reading: compiled `out/` resolves to the root `node_modules`, and `.vscodeignore` keeps `node_modules/sql.js`. Still confirm in a `.vsix` install (Phase 14)
- [x] Smart Context: replaces only file-read results (bash, search and log output pass through intact); the path comes from the paired `tool_use`; OpenAI `tool` messages handled; parse trees freed. [ ] Outline heuristics for languages without a bundled grammar are still basic
- [x] Silent Edit: invalid line numbers rejected and types checked; a triple backtick inside the JSON no longer breaks parsing; all text blocks are read; stream and non-stream replies both go through the confirmation prompt. Edits are left unsaved on purpose
- [x] Router: keyword match uses only the user's typed text (not tool output); extension detection ends at whitespace/punctuation; `maxTokens` counts tool blocks; empty `match: {}` skipped; unknown providers skipped; the built-in code rule now comes before the short-prompt rule
- [x] Prompt Cache: never exceeds four breakpoints (counts the client's own); thinking and empty blocks are skipped. [ ] Memory Weaver window shift still defeats caching; [ ] Mistral/Anthropic markers not removed when the router changes provider
- [x] Weave: `..` containment fixed for both the name check and path resolution. [ ] Per-request cache is still useless (recreated each request); [ ] skeleton can be stale vs. partial reads
- [x] Dead/stub code: `pruneMemory` now clears Memory Weaver history (with confirmation); `clearLedger` has a command; `getDailySpendUsd` and `ProxyResponse` removed. [ ] `memory.json` is still write-only
- [x] Pricing: lookup is vendor-aware with longest-match (Anthropic dated ids now resolve); empty model → cost 0; negative OpenRouter prices ignored; 24 h refresh recurs. [ ] No pricing without a workspace folder
- [ ] Cost accuracy: [ ] input tokens estimated `chars/4` — should use upstream `usage`; [ ] add cache read/write rates. [x] `exportMonthlySummary` Requests column is now a real per-month count. [x] Savings averages use real upstream calls only (cache hits excluded)

### Security
- [x] Path allowlist — only `/v1/messages`, `/v1/chat/completions`, `/v1/models` and `/v1/embeddings` are proxied; anything else returns 404
- [x] SSRF check covers bracketed and IPv4-mapped IPv6, decimal/hex IPv4, CGNAT, `fc00::/7`, `fe80::/10`. Ollama base URLs use it. [ ] Forge registry URL is https-only but doesn't use this check
- [x] Unknown router provider skipped (no longer falls through to OpenRouter's key)
- [x] Forge: timeout, status and size checks, https only. [ ] Hash pinning; remote entries still override built-ins and can fetch arbitrary URLs
- [x] Session token no longer printed to the Output Channel (copy with `TPT: Copy Session Token`); constant-time comparison; repeated header rejected
- [ ] Move API keys and session token to `SecretStorage` (currently plaintext in workspace `settings.json`); `.gitignore` check misses patterns and the no-`.gitignore` case; also ignore `.tpt/` (ledger/cache hold prompts)
- [x] Memory Weaver: corrupt `memory.json` no longer throws into the pipeline; the Ollama URL comes from the validated setting; the proxy backend keeps base path prefixes

## Phase 12 — Adoption & Usability (Pending)

- [ ] **Connect wizard** — provider + key, tool picker (Claude Code, Cline, Roo, Continue), "Test connection", preset choice; replace the dismissible toast with a VS Code `walkthroughs` contribution
- [x] `TPT: Copy Session Token`, `TPT: Copy Claude Code Setup Snippet` (PowerShell + bash), `TPT: Test Connection` and `TPT: Open Settings` added; the 401 message names the copy command
- [ ] Verify `tpt.configureCline` writes keys Cline actually reads; set the model name; reconcile `${url}` vs `${url}/v1` between docs and code
- [ ] Refresh stale terminal env on port change; warn when existing terminals hold an old URL (env is now rewritten on every activation after bind; already-open terminals keep the old value)
- [x] **Presets** — `TPT: Apply Settings Preset` offers Frugal, Privacy-first, Local only (Ollama) and Anthropic tiering; writes to workspace settings, or user settings when no folder is open. A test checks each key is a declared setting
- [x] `examples/`: Claude Code, Cline and local-model guides; router and Vault config samples; smoke-test scripts for bash and PowerShell. [ ] Roo and Continue guides, a sample ledger CSV, and a `.claude/settings.json` recipe
- [ ] Forge starter pack bundle + contribution template/schema doc
- [ ] README sync with `package.json`: missing commands (`configureModels`, `inspectLast`, `showPromptDiff`, `exportLedger`, `configureCline`, `runSetupWizard`, `resetSetup`, `exportMonthlySummary`) and settings (`costBudget.*`, `tokenShield.semanticCache.*`, `forge.registryUrl`, memoryWeaver models, per-provider keys); add Troubleshooting (401, port, stale terminal) and FAQ; link `examples/`
- [ ] Link `claude-compare.md` from README; replace estimates with measured numbers
- [ ] Surprising defaults: document that Router/Silent Edit are off and that routing to a different provider needs that provider's key; Forge `autoUpdate` makes network calls by default — add consent/privacy note
- [ ] Dashboard setup guide: show until Connect succeeds (not only `totalRequests === 0`); don't force-show Output Channel on every activation
- [x] CI: `.github/workflows/ci.yml` runs lint, compile and tests on Ubuntu, Windows and macOS (not yet run on GitHub). [ ] Publish workflow; issue/PR templates (ask for `tpt.inspectLast` output)
- [x] ESLint config added (`.eslintrc.json`); `npm run lint` passes. `test` lists all test files explicitly (a glob would need Node 21+)
- [ ] `package.json`: real `publisher`, `license`, `bugs`, `homepage`, `galleryBanner`; `.vscodeignore` should exclude `CLAUDE.md` and `claude-compare.md`; drop redundant `download-wasm` in `vscode:prepublish` (WASM is tracked)
- [ ] Cut CHANGELOG `[Unreleased]` into 0.1.1 and bump version (needs a release decision)

## Phase 13 — Innovation Ideas (Backlog)

- [ ] **Dry-run mode** — show per-stage token savings on the last request without altering traffic, so users trust modules before enabling them
- [ ] Per-module savings attribution in the dashboard + shareable monthly savings report
- [ ] Auto-tuning — suggest router rules and Memory Weaver thresholds from ledger history
- [ ] Cross-session memory recall — inject relevant `memory.json` summaries back into new conversations
- [ ] Workspace policy file (`.tpt/policy.json`) for team-shared Vault/Router/budget rules, with a trust prompt for cloned repos
- [ ] Request replay / A-B compare across models using the ledger
- [ ] Vault test-your-patterns tool and a "what would be redacted" preview
- [ ] Anonymous opt-in adoption metrics (currently zero telemetry, so adoption can't be measured)
- [ ] Cross-format routing — translate request/response between Anthropic Messages and OpenAI chat formats so routes can cross providers
- [ ] Groq and Google Gemini providers (supersedes the open Phase 10 item)

## Phase 14 — Test Coverage Gaps (In progress)

Automated: `npm run compile` clean; `npm test` 137/137 passing; `npm run lint` clean.

- [x] `runRouter`: rule matching, returned provider, unknown provider, empty match, format mismatch, keyword matching ignores tool output, built-in rule order (`routerRules.test.ts`). [ ] Override applied to the upstream request (needs an integration test)
- [x] Token Shield: key scope (model, system, format), tool-call detection (`tokenShield.test.ts`). [ ] Eviction SQL, TTL expiry, semantic cache
- [x] Memory Weaver: `pairSafeTail` and extractive pairing (`memoryWeaver.test.ts`). [ ] Threshold and summariser backends
- [x] Smart Context: read-only replacement, OpenAI `tool` messages, size threshold (`weave.test.ts`). [ ] Outline correctness for each language
- [x] Silent Edit: path containment, range validation (`editSafety.test.ts`), block parsing (`silentEditParse.test.ts`). [ ] `applyEdit` behaviour
- [ ] Forge: built-in regex validity
- [x] Vault: Bearer, array `tool_result`, `tool_use` input, `tool_calls`, PEM blocks, large blocks, `(?i)` custom patterns, ReDoS guard (`vaultExtended.test.ts`). [ ] Redaction count
- [x] Prompt Cache: existing `cache_control`, thinking blocks, breakpoint limit (`promptCacheLimits.test.ts`)
- [x] Presets: every key is a declared setting (`presets.test.ts`)
- [x] Request paths: `/v1/v1` doubling, path allowlist, token comparison (`requestPaths.test.ts`)
- [x] SSRF validation: bracketed and mapped IPv6, CGNAT, decimal/hex IPv4, provider validation (`config.test.ts`)
- [x] Ledger: CSV quoting and formula guard (`ledger.test.ts`)
- [ ] Integration (needs a running proxy): router model reaches upstream, routed-provider auth headers, streaming client disconnect aborts upstream, bodyless GET passthrough, `ANTHROPIC_CUSTOM_HEADERS` accepted by a live Claude Code session
- [ ] Manual: macOS/Linux `.vsix` install, `cache_read_input_tokens > 0` on turn 2, first CI run on GitHub
