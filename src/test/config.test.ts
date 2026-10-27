import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUserSuppliedUrl, isUpstreamProvider } from '../utils/config';

function blocked(url: string): boolean {
  try {
    validateUserSuppliedUrl(url);
    return false;
  } catch {
    return true;
  }
}

test('validateUserSuppliedUrl: localhost by name is allowed (Ollama)', () => {
  assert.equal(blocked('http://localhost:11434/v1'), false);
});

test('validateUserSuppliedUrl: public hosts are allowed', () => {
  assert.equal(blocked('https://api.example.com/v1'), false);
});

test('validateUserSuppliedUrl: dotted private, loopback, link-local and metadata IPs are blocked', () => {
  assert.equal(blocked('http://127.0.0.1:8080'), true);
  assert.equal(blocked('http://10.1.2.3'), true);
  assert.equal(blocked('http://192.168.0.5'), true);
  assert.equal(blocked('http://172.20.1.1'), true);
  assert.equal(blocked('http://169.254.169.254/latest/meta-data'), true);
  assert.equal(blocked('http://0.0.0.0'), true);
});

test('validateUserSuppliedUrl: CGNAT 100.64.0.0/10 is blocked', () => {
  assert.equal(blocked('http://100.64.0.1'), true);
  assert.equal(blocked('http://100.127.255.255'), true);
  assert.equal(blocked('http://100.128.0.1'), false);
});

test('validateUserSuppliedUrl: bracketed IPv6 loopback is blocked (brackets were not stripped before)', () => {
  assert.equal(blocked('http://[::1]:8080'), true);
  assert.equal(blocked('http://[::]/'), true);
});

test('validateUserSuppliedUrl: IPv4-mapped IPv6 loopback and private addresses are blocked', () => {
  assert.equal(blocked('http://[::ffff:127.0.0.1]/'), true);
  assert.equal(blocked('http://[::ffff:10.0.0.1]/'), true);
});

test('validateUserSuppliedUrl: unique-local and link-local IPv6 are blocked', () => {
  assert.equal(blocked('http://[fc00::1]/'), true);
  assert.equal(blocked('http://[fd12:3456::1]/'), true);
  assert.equal(blocked('http://[fe80::1]/'), true);
});

test('validateUserSuppliedUrl: decimal and hex encodings of loopback are blocked', () => {
  assert.equal(blocked('http://2130706433/'), true);  // 127.0.0.1 as decimal
  assert.equal(blocked('http://0x7f000001/'), true);  // 127.0.0.1 as hex
});

test('validateUserSuppliedUrl: non-http schemes are rejected', () => {
  assert.equal(blocked('file:///etc/passwd'), true);
  assert.equal(blocked('ftp://example.com'), true);
});

test('isUpstreamProvider: known providers pass, anything else fails', () => {
  assert.equal(isUpstreamProvider('anthropic'), true);
  assert.equal(isUpstreamProvider('openrouter'), true);
  assert.equal(isUpstreamProvider('made-up'), false);
  assert.equal(isUpstreamProvider(undefined), false);
});
