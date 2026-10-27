# Roo Code through TPT

Roo Code connects to TPT as an OpenAI-compatible provider.

## Settings

| Field | Value |
|---|---|
| API Provider | OpenAI Compatible |
| Base URL | `http://127.0.0.1:7331/v1` (use the port in the TPT Output Channel if it differs) |
| API Key | the session token from **TPT: Copy Session Token** |
| Model ID | the model name your provider expects |

Roo Code sends the API key as `Authorization: Bearer <key>`. TPT accepts the session token in that field, so you don't need a custom header. Your real provider key stays in TPT's settings, and TPT adds it to each upstream request.

The OpenAI Compatible settings Roo Code documents are base URL, API key and model ID, so there is no field for a custom header. That's why the token goes in the API key field.

## Verify

```bash
TPT_TOKEN=... ./examples/smoke-test.sh
```

Expected: `proxy answered HTTP 200`. Then send a message in Roo Code. **TPT: Inspect Last Request** shows what was sent upstream.

## If it fails

- `401` from the proxy: the API key field doesn't hold the current token. Copy it again with **TPT: Copy Session Token**.
- `401` from the upstream: TPT's provider key is missing or wrong. **TPT: Test Connection** reports the upstream's answer.
- Some gateways need a provider prefix on model IDs. Check your provider's model list.
