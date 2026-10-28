import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { compileCustomPattern, isSafeRegex } from '../modules/vault';
import { isUpstreamProvider } from '../utils/config';

// The registry as published: index.json and the configs it points at
const REGISTRY = path.join(__dirname, '..', '..', 'forge-registry');
const index = JSON.parse(fs.readFileSync(path.join(REGISTRY, 'index.json'), 'utf8')) as {
  entries: { name: string; type: string; url: string; version: string; sha256?: string }[];
};
const TYPES = new Set(['router-rule', 'vault-pattern', 'system-prompt']);

// Files are read with CRLF turned into LF, the bytes GitHub serves once committed, so the pin
// does not depend on the checkout's line endings
const committedBytes = (file: string): string => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('registry index: names are unique, types are known, and every URL points at a config in this repo', () => {
  const names = index.entries.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'names are unique');
  for (const entry of index.entries) {
    assert.ok(TYPES.has(entry.type), `${entry.name} has a known type`);
    assert.match(entry.url, /^https:\/\//, `${entry.name} is served over https`);
    const file = entry.url.split('/forge-registry/')[1];
    assert.ok(file && fs.existsSync(path.join(REGISTRY, file)), `${entry.name} points at a file that exists`);
  }
});

test('registry index: every pin matches the committed bytes of its config', () => {
  for (const entry of index.entries) {
    const file = path.join(REGISTRY, entry.url.split('/forge-registry/')[1]);
    const digest = crypto.createHash('sha256').update(committedBytes(file)).digest('hex');
    assert.equal(entry.sha256, digest, `${entry.name}: the pin is stale or the file changed without re-pinning`);
  }
});

const configOf = (name: string): unknown => {
  const entry = index.entries.find((e) => e.name === name);
  assert.ok(entry, `${name} is in the index`);
  return JSON.parse(committedBytes(path.join(REGISTRY, entry.url.split('/forge-registry/')[1])));
};

test('registry vault packs: every pattern compiles, passes the ReDoS guard, and catches its own sample token', () => {
  // A sample of each token format, split so secret scanners do not flag this file
  const samples = [
    'npm' + '_' + 'a'.repeat(36),
    'pypi-AgEIcHlwaS5vcmc' + 'x'.repeat(50),
    'dckr_pat_' + 'x'.repeat(27),
    'glpat-' + 'x'.repeat(20),
    'hf_' + 'x'.repeat(34),
    'dapi' + 'a'.repeat(32),
    'DefaultEndpointsProtocol=https;AccountName=examplestore;AccountKey=' + 'A'.repeat(88),
  ];
  const packs = index.entries.filter((e) => e.type === 'vault-pattern');
  for (const pack of packs) {
    const patterns = configOf(pack.name) as string[];
    for (const p of patterns) assert.ok(isSafeRegex(p), `${pack.name}: ${p} passes the ReDoS guard`);
    assert.ok(patterns.every((p) => compileCustomPattern(p)), `${pack.name}: every pattern compiles`);
  }
  const dev = configOf('developer-token-patterns') as string[];
  assert.equal(dev.length, samples.length);
  dev.forEach((p, i) => assert.ok(compileCustomPattern(p)!.test(samples[i]), `pattern ${i} catches its sample`));
});

test('registry router rules: every provider is a real upstream provider', () => {
  for (const entry of index.entries.filter((e) => e.type === 'router-rule')) {
    for (const rule of configOf(entry.name) as { provider: string }[]) {
      assert.equal(isUpstreamProvider(rule.provider), true, `${entry.name}: ${rule.provider}`);
    }
  }
});

test('registry system prompts: each still describes the tpt-edit block the extension parses', () => {
  for (const entry of index.entries.filter((e) => e.type === 'system-prompt')) {
    const { text } = configOf(entry.name) as { text: string };
    assert.match(text, /```tpt-edit/, `${entry.name} names the tpt-edit fence`);
    for (const key of ['file', 'startLine', 'endLine', 'newContent']) {
      assert.match(text, new RegExp(`"${key}"`), `${entry.name} shows the ${key} field`);
    }
  }
});
