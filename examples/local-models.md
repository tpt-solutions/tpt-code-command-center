# Local models (Ollama, LM Studio)

Use **TPT: Apply Settings Preset → Local only (Ollama)** for a setup where nothing leaves the machine. It sets the provider to `local`, turns the router off, and makes Memory Weaver summarise with Ollama only.

## Ollama

1. Start Ollama and pull a model: `ollama pull llama3`.
2. Set `tpt.upstreamProvider` to `local`.
3. Set `tpt.localBaseUrl` to `http://localhost:11434/v1` (the default).
4. Point the client at TPT as usual ([cline.md](cline.md) or [claude-code.md](claude-code.md)).

Ollama's `/v1` endpoint takes OpenAI-format requests, so Cline works with it. Claude Code sends Anthropic-format requests; whether a local server accepts those depends on the server and its version, so check its docs before relying on it. Cline is the safer choice for local models.

## LM Studio

1. Start the local server in LM Studio (default `http://localhost:1234/v1`).
2. Set `tpt.upstreamProvider` to `local` and `tpt.localBaseUrl` to that URL.

## Notes

- TPT refuses private IP addresses as upstream URLs. `localhost` is allowed by name, so use `localhost` rather than `127.0.0.1` for `localBaseUrl`.
- Memory Weaver's Ollama summaries use `tpt.tokenShield.semanticCache.ollamaBaseUrl`, so set that too if Ollama runs somewhere other than the default.
