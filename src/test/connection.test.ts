import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initConnectionState, markConnected, hasConnected } from '../utils/connection';

function fakeState(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  const writes: string[] = [];
  return {
    data,
    writes,
    get<T>(key: string): T | undefined {
      return data[key] as T | undefined;
    },
    update(key: string, value: unknown): unknown {
      writes.push(key);
      data[key] = value;
      return Promise.resolve();
    },
  };
}

test('connection: a fresh install has not connected yet', () => {
  initConnectionState(fakeState());
  assert.equal(hasConnected(), false);
});

test('connection: a connection recorded in an earlier session is remembered', () => {
  initConnectionState(fakeState({ 'tpt.connected': true }));
  assert.equal(hasConnected(), true);
});

test('connection: the first successful answer is persisted once', () => {
  const state = fakeState();
  initConnectionState(state);
  markConnected();
  markConnected();
  assert.equal(hasConnected(), true);
  assert.deepEqual(state.writes, ['tpt.connected']);
  assert.equal(state.data['tpt.connected'], true);
});
