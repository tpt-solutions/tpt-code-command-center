# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **Getting-started walkthrough** (`Get started with TPT`) replaces the first-run toast: connect a provider, test the connection, point your tool at TPT, watch the dashboard.
- **Starter Forge configs**: developer-token vault patterns (npm, PyPI, Docker Hub, GitLab, Hugging Face, Databricks, Azure Storage) and a shorter Silent Edit prompt.
- **Tuning suggestions give values.** The router suggestion includes a ready-to-paste `maxTokens` rule from the median request, and the Memory Weaver suggestion includes a threshold at the 90th percentile.
- **`TPT: Show Workspace Policy`** shows whether the repository's `tpt-policy.json` is present, valid and trusted, and what it would apply.
- **Setup wizard preset step.** After the provider is set, the wizard offers the presets that fit it, or keeps the current settings. A preset that would change the provider is not offered.
- **`examples/sample-ledger.csv`** shows the shape of the ledger CSV export. Its figures are made up.

### Fixed
- **Ledger rows from two windows are no longer lost.** Two windows writing at the same moment could each overwrite the other's rows. A lock file now serialises the write; four concurrent writers keep all their rows.
- **Unpinned Forge entries are contained.** An unpinned remote entry can no longer replace a built-in of the same name, the background refresh skips it, and a manual install asks for confirmation.
- **Smart Context outlines now use the parser.** The bundled tree-sitter runtime (web-tree-sitter 0.26) exports `Parser` and `Language` as separate classes, so the old lookup threw on every file and every outline silently fell back to the regex. Declarations inside method bodies are now listed (TypeScript, C#), and Go types and methods, Rust enums, Java and C# methods, and PHP and Ruby classes and methods are listed too. A file with no declarations gets the text outline, not just a header.
- **A broken `tpt-policy.json` is reported.** It was ignored without a word. TPT now shows a warning at activation.
- **`count_tokens` is never cached or summarised.** It shares its messages with a real chat request, so its count could be stored as that request's cached answer, and a later chat request would have got `{input_tokens}` back. Memory Weaver could also call a summariser for a count. Now it gets no cache key and no summary. An Anthropic-format client routed to an OpenAI-compatible provider gets the count locally, instead of a 404.

### Changed
- **Forge installs take effect.** Installed entries were written to `.tpt/forge/` but never read. Vault patterns now join the Vault, router rules apply when `tpt.router.rules` is empty, and a system prompt replaces the Silent Edit schema. Installed files use a new envelope format (`name`, `type`, `version`, `content`); files written by 0.1.1 are ignored, so reinstall them.
- **`tpt.forge.autoUpdate`** re-installs the workspace's Forge entries from the registry on activation, in the background.
- **Forge registry checks** — the registry URL and remote entry URLs go through the same address check as the upstream URLs.
- **Stream accounting buffer is capped** — a reply over 8 MB keeps its first 8 MB and last 256 KB. Silent Edit blocks in the dropped middle are not applied, and the Output Channel says so.
- **`.gitignore` prompt** now covers `.tpt/` as well as `.vscode/settings.json`.

- **Setup wizard** offers to point a tool at the proxy after a successful connection check: Claude Code, Cline, Roo Code, Continue, or another tool.
- **Pricing cache** is kept in the global storage folder when no workspace folder is open, as the ledger already was.
- **Port move warning** — if TPT starts on a different port than the terminals were given, it says so and asks for new terminals.

- **Ledger is merged, not overwritten.** Each window now adds its own new rows to `.tpt/ledger.db` as it is on disk, so rows from another VS Code window on the same workspace are kept. Clearing the ledger also clears the file. Stats in an open window still count from its own start, plus the file as it was when the window opened.
- **Memory Weaver summaries stay stable.** The summarised part of the conversation is cut on 8-message blocks, and a summary is reused for the same prefix. Repeat requests no longer call the summariser again, and the upstream prompt cache can hit for a whole block.

- **Registry entries are pinned.** The three official Forge entries carry a `sha256`, so a changed file is refused at install.

- **Silent Edit rejects an end line past the end of the file** instead of clamping it. A model with a wrong line count can no longer rewrite everything down to the end of the file. The edit is skipped and logged.

- **Router rules apply to every request.** A rule that sends requests to the Anthropic provider used to be skipped for OpenAI-format clients. The pipeline now translates them, so the rule applies.

### Added
- **Dry run** (`tpt.dryRun`). Measures what the modules would change, and sends every request exactly as the client wrote it. No cached answers are returned, and Memory Weaver uses only its local extractive backend, so a dry run makes no model calls for summaries.
- **Per-stage token savings.** Each request records its estimated size after every stage. `TPT: Show Token Savings (Last Request)` prints them to the Output Channel.
- **Cross-session memory recall** (`tpt.memoryWeaver.recall.enabled`, off by default). On the first turn of a new conversation, the Memory Weaver summaries from earlier sessions that share words with the request are added to the system prompt, marked as possibly not applicable. The cost shows as its own "Memory Recall" stage.
- **Team policy file** (`tpt-policy.json` in the repository root). It can add Vault patterns, lower cost budgets and turn on dry run. It cannot add router rules or change the provider. It applies only after the user trusts that exact file, and a changed file asks again. The file sits at the root rather than in `.tpt/` so a team can commit it.
- **Settings suggestions from history.** `TPT: Suggest Settings From History` reads the measured requests and says what it sees for Memory Weaver and the router. It suggests only, and needs 20 measured requests.
- **Savings by module.** The dashboard shows what each module removed or added, summed over measured requests. `TPT: Export Savings Report (This Month)` writes the same as a Markdown report. The ledger gains a `stage_tokens` column, added in place for existing databases. All figures are estimates (characters ÷ 4), not billed tokens.
- **OpenAI-format clients can use the Anthropic provider.** Chat requests are converted to the Anthropic messages format, and the answers (including streamed ones) are converted back to OpenAI chat. This applies whenever the provider is `anthropic`, with or without a router rule. The other direction (Anthropic-format client to an OpenAI-compatible provider) still needs a router rule, since some providers in that group speak the Anthropic format too.
- `TPT: Show Memory Weaver Summaries` opens `.tpt/memory.json`.
- Forge contribution guide and schema reference (`forge-registry/CONTRIBUTING.md`).
- Bug report issue template under `.github/`.
- README: Troubleshooting and FAQ sections, the commands and settings missing from the reference, and a note on Forge's network calls.

---

## [0.1.1] — 2026-10-28

### Added
- **TPT Weave (tpt-weave integration)** — for workspaces indexed with `tpt-weave adopt`, Rust tool-result content is replaced by the repository's indexed signatures/skeletons (`tpt.weave.enabled`, level via `tpt.weave.level`) instead of re-parsing sources in the proxy; falls back to tree-sitter/regex outlining on any miss. Dashboard gains a "Repository Context (tpt-weave)" panel (raw vs delivered tokens, reduction, cache hit rate, session replacements).
- **Live OpenRouter pricing** — fetches `/api/v1/models` once per day, cached in `.tpt/pricing.json`. Falls back to a built-in table covering all major providers when offline.
- **Daily cost budget alert** — `tpt.costBudget.dailyLimitUsd` setting; warning notification fires once per day when spending exceeds the limit.
- **Per-model cost breakdown** — dashboard now shows a "Cost by Model" table and a budget progress bar.
- **tree-sitter WASM bundling** — `scripts/download-wasm.js` downloads pre-built language grammar WASM files (TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby) to `media/wasm/`. Run `npm run download-wasm` before packaging.
- **Smart Context path detection** — reads file extension from the tool call `path`/`input.path` argument directly rather than scanning content for a filename pattern.
- **Integration test** — proxy pass-through test with a real mock upstream HTTP server (`src/test/integration/`).
- **Model picker** — `TPT: Configure Models` command for picking Memory Weaver summarisation models with live Ollama discovery.
- Streaming response support (SSE for both Anthropic and OpenAI formats)
- `.vscode/launch.json` for F5 development workflow
- Unit tests for Vault regex, hash normalisation, and Router rule matching
- Built-in default Router rules
- **Anthropic → OpenAI-compatible translation** — a router rule can send Anthropic-format requests (Claude Code) to an OpenAI-compatible provider. Requests, answers, streamed text and streamed tool calls are converted in both directions.
- **Groq and Gemini** upstream providers (`tpt.groqApiKey`, `tpt.geminiApiKey`).
- **Settings presets** — `TPT: Apply Settings Preset` (Frugal, Privacy-first, Local only, Anthropic tiering).
- **Connection test** — `TPT: Test Connection`, also run at the end of the setup wizard.
- **Recovery and copy commands** — `TPT: Copy Session Token`, `TPT: Copy Claude Code Setup Snippet`, `TPT: Open Settings`, `TPT: Clear Request Ledger`.
- **Vault preview** — `TPT: Test Vault Patterns on Selection` shows what the redaction would remove.
- **Setup guides** in `examples/` for Claude Code, Cline, Roo Code, Continue and local models, with smoke-test scripts and sample config files.
- **CI** — GitHub Actions workflow running lint, compile and tests on Ubuntu, Windows and macOS. ESLint configuration.
- **Forge hash pinning** — a registry entry can pin a SHA-256; a mismatch refuses the install.
- **Cache-aware pricing** — cached prompt tokens are billed at OpenRouter's cache read and write rates.
- **Upstream usage** — the ledger records the provider's own token counts instead of local estimates.

### Changed
- **API keys live in SecretStorage** (the OS keychain), not `settings.json`. Keys already in settings move across on first run and are removed from settings. The key settings are marked deprecated.
- **The session token is also accepted as the client's API key** (`Authorization: Bearer` or `x-api-key`), so clients without a custom-header field (Roo Code, Continue) can connect. The real provider key is still added by the proxy.
- The router runs before the provider-specific caching steps, so Mistral's cache key is only sent to Mistral.
- The proxy binds and advertises `127.0.0.1` instead of `localhost`.
- Prompt caching never exceeds Anthropic's four breakpoints and skips thinking and empty blocks.
- Ledger writes are batched (about one second) and flushed on deactivate.
- The setup guide stays until the first real upstream answer. The Output Channel no longer opens on every activation.
- Smart Context outlines only whole-file reads. Ranged reads and non-read tool output pass through unchanged.

### Fixed
- The router's chosen model is now sent upstream (it was ignored before).
- Routed requests use the routed provider's auth header and path.
- OpenAI-format requests no longer reach `/v1/v1/...` when the client and provider base URLs both end in `/v1`.
- Bodyless requests such as `GET /v1/models` pass through instead of returning 400.
- Silent Edit: edits stay inside the workspace, line ranges are validated, and a triple backtick inside an edit no longer breaks parsing. Proposed edits need confirmation before they are applied.
- Token Shield keys include the model, system prompt, tools and format, so identical messages to different models no longer share an answer. Cached answers expire after 24 hours, and answers that call a tool are never cached.
- Memory Weaver keeps each `tool_use` with its `tool_result` when it summarises.
- Vault redacts tool inputs, array-form tool results and OpenAI tool-call arguments, and no longer skips blocks over 200 KB.
- Weave: relative paths can no longer reach files outside the workspace; cached skeletons refresh when a file changes.
- The ledger's daily and monthly views use the local calendar day, and the monthly summary's Requests column is a real count.
- The ledger's CSV export escapes quotes and neutralises spreadsheet formulas.
- The daily budget check reserves each in-flight request's estimated cost, so concurrent requests cannot overshoot together.
- Startup no longer fails when there is no workspace folder; commands still work if the proxy cannot start.

### Security
- The proxy forwards only `/v1/messages`, `/v1/chat/completions`, `/v1/models` and `/v1/embeddings`; other paths return 404.
- The session token is compared in constant time and is no longer written to the Output Channel.
- Upstream URL validation covers bracketed and IPv4-mapped IPv6 addresses, decimal and hex IPv4, CGNAT, and unique-local and link-local IPv6.
- Forge registry fetches are https-only, with a timeout and a size limit.
- Ollama base URLs go through the same validation as other user-supplied URLs.

---

## [0.1.0] — 2026-06-18

### Added
- **Extension-hosted local HTTP proxy** — starts automatically on VS Code launch, shuts down on close. Dynamic port binding starting at 7331. Session token security on all requests.
- **ANTHROPIC_BASE_URL injection** — automatically injected into all VS Code terminal environments so Claude Code routes through the proxy without any manual setup.
- **Upstream provider support** — OpenRouter (default), Anthropic direct, OpenAI direct, local (Ollama/LM Studio), and custom base URL. All configurable via VS Code settings.
- **Both API formats** — handles Anthropic Messages format (`/v1/messages`) and OpenAI Chat Completions format (`/v1/chat/completions`).
- **TPT Vault** — regex-based redaction of AWS keys, Stripe tokens, GitHub PATs, JWTs, `.env` patterns, SSH private keys, and user-defined custom patterns.
- **TPT Smart Context** — replaces large file contents in AI tool results with compact AST outlines using `web-tree-sitter`. Falls back to regex-based outline extraction when no parser is available.
- **TPT Token Shield** — SHA-256 hash-based exact-match prompt cache backed by `sql.js`. Configurable size cap with LRU eviction.
- **TPT Memory Weaver** — summarises conversation history when token count exceeds a threshold. Supports Ollama, proxy LLM, and extractive fallback in a user-configurable priority order.
- **TPT Router** — rewrites the target model and upstream provider based on heuristic rules matching token count, keywords, and file extensions.
- **TPT Silent Edit** — injects a JSON edit schema into system prompts and applies matching AI responses as native undoable `WorkspaceEdit` diffs.
- **TPT Forge** — fetches and installs community router rules, vault patterns, and system prompts from a public GitHub registry.
- **TPT Terminal** — Output Channel with live pipeline logs. Verbose mode shows per-request detail.
- **Status bar item** — green/yellow/red shield icon with Quick Pick toggle menu for all modules.
- **WebView dashboard** — token ledger stats, 7-day cost chart, active module map.
- **Command Palette** — all functions accessible via `Ctrl+Shift+P` (`TPT: ...`).
- **Token Ledger** — records every request (model, tokens in/out, cost, cache hit, module actions) in a local `sql.js` database at `.tpt/ledger.db`.
- **No native modules** — uses `sql.js` (WASM) instead of `better-sqlite3`. Installs cleanly on Windows, macOS, and Linux without compilation.
