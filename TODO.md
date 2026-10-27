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

- [x] Create the Forge registry (`forge-registry/` in this repository, with `index.json` and example entries). The `tpt-forge/registry` repository named earlier was never created
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
- [x] Groq and Google Gemini added as `tpt.upstreamProvider` values (Groq `api.groq.com/openai/v1`, Gemini `generativelanguage.googleapis.com/v1beta/openai`), with their own key settings and a path rule for Gemini

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
- [x] **Forge installs never consumed** — installed entries are now read on each request: vault patterns join the Vault, router rules apply when `tpt.router.rules` is empty, and a system prompt replaces the Silent Edit schema. `forge.autoUpdate` re-installs the workspace's entries on activation. Installed files are envelopes (`name`, `type`, `version`, `content`); older bare files are ignored (`forge.test.ts`)

### Robustness
- [x] Request handler wrapped — a throw answers 500 instead of hanging the socket
- [x] Streaming: upstream aborted when the client disconnects; backpressure respected; idle timeouts; mid-stream cut-off recorded as 502. [x] Accumulated stream buffer capped (`utils/streamBuffer.ts`): the first 8 MB and the last 256 KB are kept; Silent Edit blocks in the dropped middle are not applied, and the Output Channel says so
- [x] Bodyless requests (e.g. `GET /v1/models`) passed through instead of 400. `/v1/v1` doubling for OpenAI-format requests fixed (client and provider base URLs both end in `/v1`). `/v1/messages/count_tokens` was already detected as Anthropic
- [x] Start-up: terminal-env failure no longer aborts the proxy; env is written after the port is bound (no stale port after fallback); commands register before the proxy starts, so a failed start keeps them working
- [x] Bind and advertise `127.0.0.1` instead of `localhost`
- [x] `findFreePort` bounded and retries only on EADDRINUSE; retries after a lost race; `stopProxyServer` drops open connections and `deactivate` awaits the close; pricing refreshes hourly
- [x] Hard budget stop reserves each in-flight request's estimated cost, so concurrent requests can't overshoot together. Not covered by a test, since pricing data isn't available in tests. (Bypass when `tpt.enabled` is false is by design: disabled means pass-through.) [x] Alert day now uses the local calendar day. [x] 7-day chart and monthly summary bucket by local day
- [x] Concurrent first-call init race fixed in Token Shield `getDb()` and the ledger
- [x] Ledger writes are batched (about one second, flushed on deactivate). [ ] Multi-window overwrite is still open. [x] Atomic writes (temp file + rename). [x] CSV quote escaping and formula-injection guard. [x] Read-only and virtual workspaces no longer throw
- [x] `sql.js` path checked by reading: compiled `out/` resolves to the root `node_modules`, and `.vscodeignore` keeps `node_modules/sql.js`. Still confirm in a `.vsix` install (Phase 14)
- [x] Smart Context: replaces only file-read results (bash, search and log output pass through intact); the path comes from the paired `tool_use`; OpenAI `tool` messages handled; parse trees freed. [ ] Outline heuristics for languages without a bundled grammar are still basic
- [x] Silent Edit: invalid line numbers rejected and types checked; a triple backtick inside the JSON no longer breaks parsing; all text blocks are read; stream and non-stream replies both go through the confirmation prompt. Edits are left unsaved on purpose
- [x] Router: keyword match uses only the user's typed text (not tool output); extension detection ends at whitespace/punctuation; `maxTokens` counts tool blocks; empty `match: {}` skipped; unknown providers skipped; the built-in code rule now comes before the short-prompt rule
- [x] Prompt Cache: never exceeds four breakpoints (counts the client's own); thinking and empty blocks are skipped. [x] Mistral key only set when the request really goes to Mistral (the router now runs first). [x] Memory Weaver window shift: summaries cut on fixed 8-message blocks and are reused by prefix hash, so the summarised prefix is stable for a block of turns (`summaryBoundary`, `memoryWeaverRun.test.ts`)
- [x] Weave: `..` containment fixed for both the name check and path resolution. The query and its skeleton cache are reused across requests, and skeletons are keyed on mtime and size, so edits refresh them. Ranged reads (offset/limit or line numbers) are passed through unchanged by Smart Context, so the lines the model asked for stay intact
- [x] Dead/stub code: `pruneMemory` now clears Memory Weaver history (with confirmation); `clearLedger` has a command; `getDailySpendUsd` and `ProxyResponse` removed. [x] `memory.json` is readable: `TPT: Show Memory Weaver Summaries` opens it. Cross-session recall is still the Phase 13 backlog item
- [x] Pricing: lookup is vendor-aware with longest-match (Anthropic dated ids now resolve); empty model → cost 0; negative OpenRouter prices ignored; 24 h refresh recurs. [x] Pricing cache falls back to the global storage folder when no workspace is open (`utils/dataDir.ts`, shared with the ledger)
- [ ] Cost accuracy: [x] the ledger records the provider's own token counts (`ledger/usage.ts`), falling back to the `chars/4` estimate only when none come back. [x] Cached prompt tokens are billed at OpenRouter's cache read and write rates; a model without them falls back to the prompt rate. [x] `exportMonthlySummary` Requests column is now a real per-month count. [x] Savings averages use real upstream calls only (cache hits excluded)

### Security
- [x] Path allowlist — only `/v1/messages`, `/v1/chat/completions`, `/v1/models` and `/v1/embeddings` are proxied; anything else returns 404
- [x] SSRF check covers bracketed and IPv4-mapped IPv6, decimal/hex IPv4, CGNAT, `fc00::/7`, `fe80::/10`. Ollama base URLs use it. [x] Forge registry URL is https-only and now also goes through this check (numeric private and loopback IPs refused; `localhost` by name allowed, as for Ollama); remote entry URLs are checked the same way at install
- [x] Unknown router provider skipped (no longer falls through to OpenRouter's key)
- [x] Forge: timeout, status and size checks, https only. Entries may pin a `sha256`; a mismatch refuses the install (`forge.test.ts`). [x] The three registry entries now carry `sha256` pins over the committed bytes (the working copy has CRLF, so the pins are the git blob digests, not the checkout's). [ ] Community entries still need pins when they are added; remote entries still override built-ins and can fetch arbitrary https URLs; remote entries still override built-ins and can fetch arbitrary URLs
- [x] Session token no longer printed to the Output Channel (copy with `TPT: Copy Session Token`); constant-time comparison; repeated header rejected
- [x] API keys live in SecretStorage and are moved out of `settings.json` on first run; the key settings are marked deprecated (`secrets.test.ts`). The session token was already in global state, not settings. [x] `.gitignore` check now covers the `.tpt/` folder as well as `.vscode/settings.json` (ledger and cache hold prompts)
- [x] Memory Weaver: corrupt `memory.json` no longer throws into the pipeline; the Ollama URL comes from the validated setting; the proxy backend keeps base path prefixes

## Phase 12 — Adoption & Usability (Pending)

- [x] The session token is also accepted as the client's API key (`Authorization: Bearer` or `x-api-key`), so Roo Code and Continue, which have no custom-header field in their OpenAI-compatible settings, can connect. The real provider key is still added by the proxy
- [ ] **Connect wizard** — [x] provider and key, and a "Test connection" check at the end (the result shows in the message, with Open Settings on failure). [x] Tool picker after a good check (Claude Code, Cline, Roo, Continue, other); [ ] preset choice inside the wizard; [ ] replace the dismissible toast with a VS Code `walkthroughs` contribution
- [x] `TPT: Copy Session Token`, `TPT: Copy Claude Code Setup Snippet` (PowerShell + bash), `TPT: Test Connection` and `TPT: Open Settings` added; the 401 message names the copy command
- [ ] Verify `tpt.configureCline` writes keys Cline actually reads (`cline.apiProvider`, `cline.openAiBaseUrl`, `cline.openAiHeaders`): not verified. Cline is not installed here, and a web search did not confirm the names. Check them by picking OpenAI Compatible in Cline's UI, entering a base URL and header, then reading the settings it writes. Set the model name; reconcile `${url}` vs `${url}/v1` between docs and code
- [x] Warn when the port moves: the last port given to terminals is remembered, and a change shows a message asking for new terminals (env is rewritten on every activation after bind). [ ] Refreshing already-open terminals is not possible through the VS Code API, so it stays a warning
- [x] **Presets** — `TPT: Apply Settings Preset` offers Frugal, Privacy-first, Local only (Ollama) and Anthropic tiering; writes to workspace settings, or user settings when no folder is open. A test checks each key is a declared setting
- [x] `examples/`: Claude Code, Cline and local-model guides; router and Vault config samples; smoke-test scripts for bash and PowerShell. [x] Roo Code and Continue guides. [x] Claude Code settings-file recipe (`claude-code-settings.json`, user-level). [ ] A sample ledger CSV
- [x] Contribution guide and schema doc (`forge-registry/CONTRIBUTING.md`). [ ] Starter pack: the three built-in configs are the pack for now; more are still to be written
- [x] README sync with `package.json`: every command and the missing settings (`costBudget.*`, `tokenShield.semanticCache.*`, `forge.registryUrl`, memoryWeaver models, per-provider keys) are listed; Troubleshooting (401, port, stale terminal) and FAQ added. [x] Link `examples/` from the README
- [x] Link `claude-compare.md` from README (flagged as estimates). [ ] Replace the estimates with measured numbers
- [x] Surprising defaults: README now says Router/Silent Edit are off, that routing to another provider needs its key, and where Forge auto-update and the OpenRouter pricing fetch make network calls
- [x] Dashboard setup guide stays until the first real upstream answer (persisted as `tpt.connected`); the Output Channel no longer opens on every activation
- [x] CI: `.github/workflows/ci.yml` runs lint, compile and tests on Ubuntu, Windows and macOS (not yet run on GitHub). [x] Bug report issue template (asks for `TPT: Inspect Last Request` output). No PR template: contributions are issues only. [ ] Publish workflow
- [x] ESLint config added (`.eslintrc.json`); `npm run lint` passes. `test` lists all test files explicitly (a glob would need Node 21+)
- [x] `package.json` repository, bugs and homepage point at `tpt-solutions/tpt-code-command-center`. `.vscodeignore` excludes `CLAUDE.md` and `claude-compare.md` (check the `.vsix` contents once packaged)
- [ ] `package.json`: real `publisher` (needs a VS Code Marketplace publisher account, so it stays with you). [x] `license` is `(MIT OR Apache-2.0)`, matching the LICENSE-MIT and LICENSE-APACHE files. [ ] `galleryBanner` (optional)
- [x] CHANGELOG cut into 0.1.1 (2026-10-28) and the version bumped to 0.1.1, following the recommendation

## Phase 13 — Innovation Ideas (Backlog)

- [x] **Dry-run mode** — `tpt.dryRun` measures what the modules would change and sends every request as the client wrote it (no cached answers, Memory Weaver extractive only). `TPT: Show Token Savings (Last Request)` prints the per-stage counts (`pipelineDryRun.test.ts`). The "without altering traffic" part is covered end to end: the request reaches the provider byte for byte (`proxy.reverse.integration.test.ts`)
- [x] Per-module savings attribution in the dashboard ("Savings by Module") + shareable monthly savings report (`TPT: Export Savings Report (This Month)`, Markdown in Downloads). Figures are estimates (characters ÷ 4 per stage), stored per request in the ledger's `stage_tokens` column, which is added in place for older ledgers (`savingsReport.test.ts`)
- [x] Auto-tuning — `TPT: Suggest Settings From History` reads the ledger and suggests (never sets) a Memory Weaver fix or a router trial. Needs 20 measured requests (`tuningSuggestions.test.ts`). Router suggestions are size-based only: nothing measures the cost of the model that answers. [ ] Suggested router rules and threshold values, rather than the pointers given now
- [x] Cross-session memory recall — opt-in (`tpt.memoryWeaver.recall.enabled`, off by default). On the first turn of a conversation, the saved summaries that share at least a fifth of the request's words (up to two) go in the system prompt, marked as possibly not applicable. Its cost is its own stage, "Memory Recall" (`recall.test.ts`). [ ] Recall from the `.tpt/memory.json` summaries only; there is no index beyond word overlap
- [x] Workspace policy file for team-shared rules, with a trust prompt for cloned repos. Lives at `tpt-policy.json` in the repo root, not `.tpt/policy.json`: `.tpt/` is git-ignored, so a policy there could not be shared. It can only tighten: Vault patterns, lower cost budgets, dry run on. It cannot add router rules or change the provider. It applies only after the user trusts that exact file (by hash), so a changed file asks again (`policy.test.ts`). [ ] Policy status command; a warning for a broken file (it is ignored silently now)
- [ ] Request replay / A-B compare across models using the ledger — **not built, by recommendation**: the ledger stores no prompts, and replay needs the request bodies, so it would mean keeping prompts on disk. If wanted, it should be an explicit opt-in that stores prompts, not a default
- [x] Vault preview: `TPT: Test Vault Patterns on Selection` shows the redacted text for the selection or typed input
- [ ] Anonymous opt-in adoption metrics — **not built, by recommendation**: the extension sends nothing anywhere except the provider the user chose and the two checks in the README, and that is a promise to users. Adoption can be measured from GitHub and Marketplace counts instead
- [x] Cross-format routing, Anthropic → OpenAI-compatible direction: requests, answers, streamed text and tool calls (`translate.test.ts`, end-to-end in `proxy.server.integration.test.ts`). [x] The reverse direction, OpenAI-format client to the Anthropic provider: chat requests, answers, streamed text and tool calls, and usage when `include_usage` is set (`translateReverse.test.ts`, `pipelineReverse.test.ts`). It applies whenever the provider is `anthropic`, with or without a router rule. The server wiring is covered end to end by `proxy.reverse.integration.test.ts`, through a test-only Anthropic base URL seam that no setting can reach. [x] count_tokens, which has no OpenAI equivalent, is answered locally with the ledger's estimate and never sent upstream (`proxy.reverse.integration.test.ts`) are still open
- [x] Groq and Google Gemini providers (done, see Phase 10)

## Phase 14 — Test Coverage Gaps (In progress)

Automated: `npm run compile` clean; `npm test` 308/308 passing; `npm run lint` clean.

- [x] `runRouter`: rule matching, returned provider, unknown provider, empty match, format mismatch, keyword matching ignores tool output, built-in rule order (`routerRules.test.ts`). [ ] Override applied to the upstream request (needs an integration test)
- [x] Token Shield: key scope (model, system, format), tool-call detection (`tokenShield.test.ts`). [x] Eviction and TTL expiry (`tokenShieldStore.test.ts`, real store with the clock mocked). [ ] Semantic cache
- [x] Memory Weaver: `pairSafeTail` and extractive pairing (`memoryWeaver.test.ts`). [x] Threshold, extractive window size and tool-pair safety, unknown backends (`memoryWeaverRun.test.ts`). [x] Ollama and proxy summariser backends, memo reuse, and fall-through when Ollama is unreachable (`summariserBackends.test.ts`, local fake server)
- [x] Smart Context: read-only replacement, OpenAI `tool` messages, size threshold (`weave.test.ts`). [ ] Outline correctness for each language
- [x] Silent Edit: path containment, range validation (`editSafety.test.ts`), block parsing (`silentEditParse.test.ts`). [x] `applyEdit` behaviour (`silentEditApply.test.ts`: range mapping, workspace containment, unopenable file, VS Code rejecting the batch, no folder open)
- [x] Forge: built-in regex validity (`forgeBuiltins.test.ts`): every vault pattern compiles and passes the ReDoS guard; every router rule names a real provider
- [x] Vault: Bearer, array `tool_result`, `tool_use` input, `tool_calls`, PEM blocks, large blocks, `(?i)` custom patterns, ReDoS guard (`vaultExtended.test.ts`). [ ] Redaction count
- [x] Prompt Cache: existing `cache_control`, thinking blocks, breakpoint limit (`promptCacheLimits.test.ts`)
- [x] Presets: every key is a declared setting (`presets.test.ts`)
- [x] Request paths: `/v1/v1` doubling, path allowlist, token comparison (`requestPaths.test.ts`)
- [x] SSRF validation: bracketed and mapped IPv6, CGNAT, decimal/hex IPv4, provider validation (`config.test.ts`)
- [x] Ledger: CSV quoting and formula guard (`ledger.test.ts`), batched persistence (`ledgerPersistence.test.ts`)
- [x] Weave skeleton freshness (`weaveFreshness.test.ts`), Mistral key gating (`pipeline.test.ts`), cache-aware cost (`pricing.test.ts`), upstream usage parsing (`usage.test.ts`)
- [x] End-to-end against the real server (`proxy.server.integration.test.ts`, mock upstream): routed model reaches the upstream with a single `/v1` path; a cross-format rule is not applied; bodyless `GET /v1/models` passes through; missing or wrong token gets 401; a path outside the allowlist gets 404 and never reaches the upstream
- [x] Routed-provider auth header and streaming client disconnect (which stops the upstream stream), both end to end
- [x] Claude Code documents `ANTHROPIC_CUSTOM_HEADERS` as `Name: Value` pairs separated by newlines, from v2.1.227, and documents the `env` key in settings files (checked against the official env-vars page)
- [ ] Still open: a live Claude Code session sends `X-TPT-Token` through `ANTHROPIC_CUSTOM_HEADERS` and gets through the proxy
- [ ] Manual: macOS/Linux `.vsix` install, `cache_read_input_tokens > 0` on turn 2, first CI run on GitHub
