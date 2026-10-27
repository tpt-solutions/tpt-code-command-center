# Contributing a Forge config

TPT Forge installs community configs into a workspace's `.tpt/forge/` folder. This page describes the registry format and the rules an entry must meet before it is accepted. Contributions are issues only: suggest a config by opening a GitHub issue with the config inlined. The maintainer adds the file and the index entry.

## How it fits together

- `index.json` lists the entries. The extension reads it from the registry URL (`tpt.forge.registryUrl`, or the official registry when that is empty).
- Each entry points at a JSON file in `configs/` through its `url`.
- Installing an entry writes an envelope to `.tpt/forge/<name>.json`. The pipeline reads that folder on every request.

## The index entry

```json
{
  "name": "my-config",
  "description": "One sentence on what it changes and why",
  "type": "router-rule",
  "url": "https://raw.githubusercontent.com/<owner>/<repo>/master/forge-registry/configs/my-config.json",
  "version": "1.0.0",
  "sha256": "64 lowercase hex characters, optional"
}
```

- `name` must be unique. Letters, digits, `_` and `-` are kept; anything else in a name becomes `-` in the installed filename.
- `type` is one of `router-rule`, `vault-pattern` or `system-prompt`.
- `url` must be `https`, and must not point at a numeric private, loopback or link-local address.
- `sha256` is the digest of the file at `url`. A mismatch refuses the install. Pin it for anything you want to stay fixed. Entries without a pin install without an integrity check.
- A remote entry with the same `name` as a built-in replaces the built-in.

## The config file, by type

### `router-rule`

A JSON array of rules, in the same shape as `tpt.router.rules`:

```json
[
  { "match": { "maxTokens": 1500 }, "model": "openai/gpt-4o-mini", "provider": "openrouter" }
]
```

- Each rule needs at least one of `maxTokens`, `keywords` or `extensions`. A rule with no criteria is skipped.
- `provider` must be a supported `tpt.upstreamProvider` value. An unknown provider is skipped.
- Rules apply only when the user has no rules of their own. The first match wins.
- Rules can send a request to a different provider. Say which provider, and why, in the description.

### `vault-pattern`

A JSON array of regex strings, in the same form as `tpt.vault.customRegex`:

```json
["(?i)acme-[a-z0-9]{20}"]
```

- Each pattern must compile, and must pass the ReDoS guard: no nested quantifiers such as `(a+)+`. Patterns that fail are skipped.
- `(?i)` at the start sets case-insensitive matching.
- Add a test string to the description so reviewers can see what the pattern catches.

### `system-prompt`

An object with a `text` string. When Silent Edit is on, the text replaces the built-in edit schema:

```json
{
  "name": "My Silent Edit prompt",
  "description": "What the prompt asks the model to do",
  "text": "You can apply file edits by outputting a tpt-edit JSON block ..."
}
```

- The text must still describe the `tpt-edit` format the extension parses, or edits will not be applied. See `configs/silent-edit-system-prompt.json` for the working format.
- A system prompt is read by the model and changes its behaviour, so keep it short and say what it changes.

## Before suggesting a config

1. Check that the JSON parses and the file matches its type above.
2. Install it locally with `TPT: Browse Forge`, then send a request through the proxy and check the Output Channel shows the expected action (for example `router:` or `vault:redacted=`).
3. Include the exact JSON in the issue, and say what it changes and why.

The maintainer adds the file under `configs/`, adds the entry to `index.json`, and computes the `sha256` pin over the committed bytes.

## What the maintainer checks

- The config does what its description says, and nothing else.
- No provider, endpoint or key is hard-coded that would send a user's code somewhere they did not choose.
- Vault patterns do not match ordinary code, such as variable names or the words `token` and `secret` on their own.
- Router rules do not route to a provider the description does not mention.
