# Cline through TPT

Cline talks to the OpenAI-compatible API, so TPT is configured as a custom OpenAI-compatible provider.

## Automatic

Run **TPT: Auto-Configure Cline**. It sets the provider, base URL and `X-TPT-Token` header in Cline's settings. The header value is the session token, so this stays in your settings and is not printed.

## Manual

In Cline's settings:

| Field | Value |
|---|---|
| API Provider | OpenAI Compatible |
| Base URL | `http://127.0.0.1:7331/v1` (use the port in the TPT Output Channel if it differs) |
| API Key | any non-empty text. TPT replaces it with your provider key. |
| Custom header | `X-TPT-Token` = the token from **TPT: Copy Session Token** |
| Model ID | the model name your provider expects, for example `gpt-4o` or `deepseek-chat` |

## Verify

```bash
TPT_TOKEN=... ./examples/smoke-test.sh
```

Expected: `proxy answered HTTP 200`. Then send a message in Cline. **TPT: Inspect Last Request** shows what was sent upstream.

## Notes

- Only `/v1/chat/completions`, `/v1/models` and `/v1/embeddings` are proxied. Other paths return 404.
- Router rules apply to OpenAI-format requests like these, so a rule that targets an OpenAI-compatible provider works here.
