# Continue through TPT

Continue connects to TPT through an `openai` provider, with `apiBase` pointing at the proxy. The field names below come from Continue's YAML reference. Check them against your Continue version if it reports a schema error.

## config.yaml

Put this in `~/.continue/config.yaml`:

```yaml
name: TPT
version: 1.0.0
schema: v1
models:
  - name: Claude through TPT
    provider: openai
    model: claude-sonnet-5-5
    apiBase: http://127.0.0.1:7331/v1
    apiKey: <session token from TPT: Copy Session Token>
```

- `provider: openai` makes Continue send OpenAI-format requests, which TPT's `/v1/chat/completions` endpoint takes.
- `apiKey` is the session token. Continue sends it as `Authorization: Bearer <apiKey>`, and TPT accepts it there. Your provider key stays in TPT's settings.
- `model` is the name your provider expects, so use the one you configured in TPT's upstream provider.

If you'd rather keep the token out of the key field, Continue's `requestOptions` can set a header instead:

```yaml
    requestOptions:
      headers:
        X-TPT-Token: <session token>
```

## Verify

```bash
TPT_TOKEN=... ./examples/smoke-test.sh
```

Expected: `proxy answered HTTP 200`. Then ask Continue a question. **TPT: Inspect Last Request** shows what was sent upstream.

## If it fails

- `401` from the proxy: the token in `apiKey` is stale. Copy it again with **TPT: Copy Session Token**.
- `401` from the upstream: TPT's provider key is missing or wrong. **TPT: Test Connection** reports the upstream's answer.
- Continue's `apiBase` must include `/v1`, because TPT only proxies `/v1/...` paths.
