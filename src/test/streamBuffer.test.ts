import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StreamBuffer } from '../utils/streamBuffer';

test('stream buffer: a short stream is kept whole', () => {
  const buf = new StreamBuffer(1024, 64);
  buf.push(Buffer.from('data: one\n\n'));
  buf.push(Buffer.from('data: two\n\n'));
  assert.equal(buf.wasTruncated, false);
  assert.equal(buf.text(), 'data: one\n\ndata: two\n\n');
});

test('stream buffer: past the head limit the start and the end are kept, not the middle', () => {
  const buf = new StreamBuffer(16, 8);
  buf.push(Buffer.from('HEADHEADHEADHEAD')); // fills the head exactly
  for (let i = 0; i < 50; i++) buf.push(Buffer.from('middle..'));
  buf.push(Buffer.from('END'));

  assert.equal(buf.wasTruncated, true);
  const text = buf.text();
  assert.ok(text.startsWith('HEADHEADHEADHEAD\n'));
  assert.ok(text.endsWith('END'));
  assert.ok(text.length < 16 + 1 + 8 * 3, `kept ${text.length} bytes, expected the tail to stay bounded`);
});

test('stream buffer: the head is filled across a chunk boundary', () => {
  const buf = new StreamBuffer(10, 100);
  buf.push(Buffer.from('abcdef'));
  buf.push(Buffer.from('ghijkl'));
  assert.equal(buf.wasTruncated, true);
  assert.ok(buf.text().startsWith('abcdefghij\n'));
  assert.ok(buf.text().endsWith('kl'));
});

test('stream buffer: the tail never grows past twice its limit', () => {
  const buf = new StreamBuffer(0, 32);
  for (let i = 0; i < 1000; i++) buf.push(Buffer.alloc(16, 0x61));
  assert.ok(buf.text().length <= 1 + 64);
});
