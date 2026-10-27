import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runVault, isSafeRegex, compileCustomPattern } from '../modules/vault';

const SECRET_KEY = 'sk-ant-' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4';
const BEARER = 'Bearer ' + 'eyJhbGciOi.payload_part-123456789';

function redact(body: Record<string, unknown>): string {
  return JSON.stringify(runVault(body, []).body);
}

test('redacts a secret inside an array-form tool_result (file reads)', () => {
  const body = {
    messages: [{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: `KEY=${SECRET_KEY}` }] }],
    }],
  };
  const out = redact(body);
  assert.ok(!out.includes(SECRET_KEY));
  assert.ok(out.includes('[REDACTED]'));
});

test('redacts a secret the model echoed into a tool_use input', () => {
  const body = {
    messages: [{
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file: 'a.txt', body: { key: SECRET_KEY } } }],
    }],
  };
  assert.ok(!redact(body).includes(SECRET_KEY));
});

test('redacts a secret in OpenAI tool_calls arguments', () => {
  const body = {
    messages: [{
      role: 'assistant',
      content: null,
      tool_calls: [{ id: '1', type: 'function', function: { name: 'write', arguments: `{"k":"${SECRET_KEY}"}` } }],
    }],
  };
  assert.ok(!redact(body).includes(SECRET_KEY));
});

test('redacts an Authorization Bearer token', () => {
  const body = { messages: [{ role: 'user', content: `curl -H "Authorization: ${BEARER}"` }] };
  assert.ok(!redact(body).includes('payload_part-123456789'));
});

test('redacts the full PEM private key body, not just the header line', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nabcdefghijklmnop\n-----END PRIVATE KEY-----';
  const body = { messages: [{ role: 'user', content: pem }] };
  const out = redact(body);
  assert.ok(!out.includes('MIIEvQIBADANBgkqhkiG9w0BAQEFAASC'));
  assert.ok(!out.includes('END PRIVATE KEY'));
});

test('a secret inside a very large block is still redacted (no silent size cap)', () => {
  const big = 'lorem ipsum '.repeat(30000) + SECRET_KEY;
  const body = { messages: [{ role: 'user', content: big }] };
  assert.ok(!redact(body).includes(SECRET_KEY));
});

test('a custom pattern written with a leading (?i) flag works', () => {
  const body = { messages: [{ role: 'user', content: 'Internal-Token: ZZZZ' }] };
  const result = runVault(body, ['(?i)internal-token:\\s*\\w+']);
  assert.equal(result.redacted > 0, true);
  assert.ok(!JSON.stringify(result.body).includes('ZZZZ'));
});

test('compileCustomPattern: (?i) becomes the i flag, and invalid syntax returns undefined', () => {
  const re = compileCustomPattern('(?i)abc');
  assert.ok(re);
  assert.equal(re.flags.includes('i'), true);
  assert.equal(compileCustomPattern('(unclosed'), undefined);
});

test('isSafeRegex: nested quantifier patterns are rejected', () => {
  assert.equal(isSafeRegex('(a+)+b'), false);
  assert.equal(isSafeRegex('[a-z]+'), true);
});
