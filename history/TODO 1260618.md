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

- [ ] Add `.vscode/launch.json` — F5 Extension Development Host configuration
- [ ] Add `.vscode/tasks.json` — build/watch tasks
- [ ] Create `media/icon.png` — 128×128 marketplace icon (currently placeholder SVG only)
- [ ] Add `.vscode/settings.json` example for Cline setup (base URL + `X-TPT-Token` header)
- [ ] Write unit tests (`src/test/`) — Vault regex, hash normalisation, router rule matching
- [ ] Add integration test — proxy pass-through with a mock upstream server

## Phase 4 — Streaming & Edge Cases (Pending)

- [ ] Handle **streaming responses** (`stream: true`) — currently assumes non-streaming JSON bodies
- [ ] Handle **Anthropic streaming** (`text/event-stream` SSE format)
- [ ] Handle **OpenAI streaming** (`data: [DONE]` SSE format)
- [ ] Token counting from streaming chunks (accumulate for ledger)
- [ ] Silent Edit interception for streamed responses
- [ ] Graceful proxy error page (currently returns raw JSON error)

## Phase 5 — Smart Context Enhancements (Pending)

- [ ] Bundle tree-sitter language WASM files for TypeScript, JavaScript, Python, Go, Rust
  - These must ship with the extension (not fetched at runtime) for offline/air-gapped use
  - Add to `package.json` files array and `.vscodeignore` whitelist
- [ ] Support outline extraction for additional languages (C#, Java, PHP, Ruby)
- [ ] Detect file extension from tool call `path` argument rather than content heuristic

## Phase 6 — Router & Cost Tracking (Pending)

- [ ] Seed Router with built-in default rules (e.g. `maxTokens: 2000` → `gpt-4o-mini`)
- [ ] Pull live model pricing from OpenRouter API and cache locally (refresh daily)
- [ ] Display per-model cost breakdown in the dashboard
- [ ] Add "cost budget" alert — warn when daily spend exceeds a threshold

## Phase 7 — Forge Registry (Pending)

- [ ] Create the `tpt-forge/registry` GitHub repository with `index.json` and example entries
- [ ] Publish initial community configs:
  - [ ] Default router rules set
  - [ ] Common Vault patterns (internal company key formats)
  - [ ] System prompt templates for Silent Edit schema

## Phase 8 — Packaging & Release (Pending)

- [ ] Install `vsce` and run `vsce package` — verify `.vsix` builds cleanly
- [ ] Test `.vsix` install on clean Windows machine
- [ ] Test `.vsix` install on macOS
- [ ] Test `.vsix` install on Linux
- [ ] Create `media/icon.png` 128×128 and 256×256 versions
- [ ] Fill in `package.json` `publisher` field with real VS Code Marketplace publisher ID
- [ ] Write marketplace listing description and screenshots
- [ ] Publish to VS Code Marketplace via `vsce publish`
- [ ] Tag v0.1.0 release on GitHub
- [ ] Write `CHANGELOG.md` v0.1.0 entry

## Phase 9 — Future Ideas (Backlog)

- [ ] Semantic cache upgrade — replace hash matching with local embedding similarity (opt-in, for users who install `ollama` and want fuzzy matching)
- [ ] Cline auto-configuration — detect Cline settings and offer to configure the base URL automatically
- [ ] Multi-workspace support — one proxy instance per VS Code window
- [ ] Token budget per project — configurable daily/weekly spend cap that disables forwarding when exceeded
- [ ] Prompt diff view — side-by-side "before/after TPT" view of what was sent vs what the AI received
- [ ] TPT Inspect command — show exactly what the last request looked like after the pipeline
- [ ] Export ledger to CSV
