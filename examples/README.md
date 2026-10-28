# TPT examples

Copy-paste setups for the tools TPT works with. Start with the one you use.

| I use… | Read |
|---|---|
| Claude Code (CLI or VS Code) | [claude-code.md](claude-code.md), and [claude-code-settings.json](claude-code-settings.json) for a settings-file setup |
| Cline (OpenAI-compatible provider) | [cline.md](cline.md) |
| Roo Code (OpenAI Compatible provider) | [roo-code.md](roo-code.md) |
| Continue (`config.yaml`) | [continue.md](continue.md) |
| Ollama or LM Studio on this machine | [local-models.md](local-models.md) |

Config files you can drop in:

- [router-anthropic-tiering.json](router-anthropic-tiering.json): `tpt.router.rules` for Claude-only use (Haiku for short requests, Sonnet for code).
- [vault-custom-patterns.json](vault-custom-patterns.json): `tpt.vault.customRegex` samples for in-house credential formats.
- [sample-ledger.csv](sample-ledger.csv): the shape of **TPT: Export Ledger to CSV** output. The rows are made up (illustrative prices and tokens), so use them to check your own spreadsheet or script, not to report real figures.

Check that the proxy works before you debug anything else:

- [smoke-test.sh](smoke-test.sh) (macOS, Linux, Git Bash)
- [smoke-test.ps1](smoke-test.ps1) (Windows PowerShell)

Both read `TPT_TOKEN`, which terminals opened in a TPT workspace already have set. If the smoke test reports `401`, copy the token again with **TPT: Copy Session Token**.
