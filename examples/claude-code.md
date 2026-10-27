# Claude Code through TPT

TPT runs a local proxy on `127.0.0.1` (port 7331, or the next free one). Claude Code sends its requests there, and TPT forwards them to your provider after applying the enabled modules.

## Option 1: automatic (recommended)

New terminals opened in a folder with TPT running already have these set:

- `ANTHROPIC_BASE_URL` points at the proxy
- `ANTHROPIC_CUSTOM_HEADERS` carries `X-TPT-Token`

Open a new terminal and run `claude`. Terminals that were open before TPT started don't have the variables. Open a new one.

## Option 3: Claude Code settings file

Put the variables in `~/.claude/settings.json` under `env`. Claude Code applies them to every session, including ones started outside a TPT workspace. Start from [claude-code-settings.json](claude-code-settings.json) and replace the token.

Use the **user** settings file, not a project file. Project and local settings are read under extra rules, and a project file that holds the token could be committed to git. Because this file is global, Claude Code will send requests to TPT even when TPT isn't running, and they will fail with a connection error. Remove the `env` block to go back to direct connections.

The port is fixed at 7331 in this file. If TPT chose another port, the Output Channel shows the one in use.

Claude Code needs **v2.1.227 or later** for `ANTHROPIC_CUSTOM_HEADERS`. Restart Claude Code after editing the file.

## Option 2: copy and paste

Run **TPT: Copy Claude Code Setup Snippet** from the command palette. It copies both PowerShell and bash versions with the current port and token. Paste into a terminal, then run `claude`.

## Verify

```powershell
# PowerShell
.\examples\smoke-test.ps1
```

```bash
# bash
TPT_TOKEN=... ./examples/smoke-test.sh
```

Expected: `proxy answered HTTP 200`. If it's `401`, the token is stale: copy it again. If it's `502` or the upstream returns `401`, the provider key is missing or wrong for the upstream in `tpt.upstreamProvider`. **TPT: Test Connection** reports the same thing without a terminal.

## Using an OpenAI-compatible provider

Claude Code speaks Anthropic's format. A router rule can send its requests to an OpenAI-compatible provider (Groq, Gemini, DeepSeek, OpenRouter and others), and TPT converts the request and the answer between the two formats:

```json
{
  "tpt.router.enabled": true,
  "tpt.router.rules": [
    { "match": { "maxTokens": 2000 }, "model": "llama-3.3-70b-versatile", "provider": "groq" }
  ]
}
```

Converted: system prompts, text and images, tool definitions and tool use and results, and both streamed text and streamed tool calls.

Limits:

- The rule's `model` is the provider's model name, not a Claude name.
- Only `/v1/messages` is converted. `count_tokens` returns 404 on a routed request.
- Anthropic-only features (thinking blocks, prompt caching markers, citations) are dropped.
- A request no rule matches goes to the global provider unchanged.
- Requests from OpenAI-format clients are not converted to Anthropic. A rule that would do that is skipped.

## Notes

- Claude Code is in Anthropic format. Router rules that send Claude requests to an OpenAI-compatible provider are skipped, because the request body is not translated. Use an `anthropic`-provider rule (see [router-anthropic-tiering.json](router-anthropic-tiering.json)) or leave the router off.
- Only `/v1/messages` (including `count_tokens`) and `/v1/models` are proxied for Claude Code. Other paths return 404.
- Silent Edit proposals appear as an **Apply / Discard** prompt. Nothing is written until you click Apply.
