import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWeaveQuery, getWeaveSessionStats, Runner } from '../modules/weave';
import { runSmartContext } from '../modules/smartContext';
import { Message } from '../proxy/types';

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-weave-test-'));
  fs.mkdirSync(path.join(dir, '.tpt-weave'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.tpt-weave', 'manifest.toml'), '[repository]\nname = "fixture"\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n');
  return dir;
}

function fakeRunner(response: { stdout: string } | Error): { runner: Runner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: Runner = async (_cmd: string, args: string[]) => {
    calls.push(args);
    if (response instanceof Error) throw response;
    return response;
  };
  return { runner, calls };
}

const SKELETON_JSON = JSON.stringify({
  path: 'src/lib.rs',
  level: 'skeleton',
  token_estimate: 12,
  text: '[skeleton of lib.rs]',
});

// ── createWeaveQuery ──────────────────────────────────────────────────────────

test('createWeaveQuery: no indexed roots → undefined', () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-weave-bare-'));
  const query = createWeaveQuery({ roots: [bare], runner: fakeRunner({ stdout: '' }).runner });
  assert.equal(query, undefined);
});

test('createWeaveQuery: skeleton resolves relative path and parses CLI JSON', async () => {
  const repo = tempRepo();
  const { runner, calls } = fakeRunner({ stdout: SKELETON_JSON });
  const query = createWeaveQuery({ roots: [repo], runner })!;
  const text = await query.skeleton('src/lib.rs', 4000);
  assert.equal(text, '[skeleton of lib.rs]');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ['--path', repo, 'skeleton']);
  assert.deepEqual(calls[0].slice(3), ['src/lib.rs', '--json']);
});

test('createWeaveQuery: absolute paths under a root are relativised', async () => {
  const repo = tempRepo();
  const { runner, calls } = fakeRunner({ stdout: SKELETON_JSON });
  const query = createWeaveQuery({ roots: [repo], runner })!;
  const text = await query.skeleton(path.join(repo, 'src', 'lib.rs'));
  assert.equal(text, '[skeleton of lib.rs]');
  assert.equal(calls[0][3], 'src/lib.rs');
});

test('createWeaveQuery: repeat lookups are served from the skeleton cache', async () => {
  const repo = tempRepo();
  const { runner, calls } = fakeRunner({ stdout: SKELETON_JSON });
  const query = createWeaveQuery({ roots: [repo], runner })!;
  await query.skeleton('src/lib.rs');
  await query.skeleton('src/lib.rs');
  assert.equal(calls.length, 1);
});

test('createWeaveQuery: unknown files and CLI failures fall back (undefined)', async () => {
  const repo = tempRepo();
  const { runner } = fakeRunner(new Error('exit 3'));
  const query = createWeaveQuery({ roots: [repo], runner })!;
  assert.equal(await query.skeleton('src/missing.rs'), undefined);
  // Malformed JSON is also a fallback.
  const broken = createWeaveQuery({
    roots: [repo],
    runner: fakeRunner({ stdout: 'not json' }).runner,
  })!;
  assert.equal(await broken.skeleton('src/lib.rs'), undefined);
});

// ── runSmartContext × weave ───────────────────────────────────────────────────

function toolResult(content: string, toolPath: string): Message {
  return {
    role: 'user',
    content: [{ type: 'tool_result', content, path: toolPath }],
  };
}

test('runSmartContext: .rs tool results prefer the weave skeleton', async () => {
  const raw = 'x'.repeat(600_000);
  const messages: Message[] = [toolResult(raw, 'src/lib.rs')];
  const skeletonsServed: Array<string | undefined> = [];
  const result = await runSmartContext(messages, 512_000, {
    skeleton: async (rel, rawBytes) => {
      assert.equal(rel, 'src/lib.rs');
      assert.equal(rawBytes, 600_000);
      skeletonsServed.push(rel);
      return '[weave skeleton]';
    },
  });
  assert.equal(result.replaced, 1);
  assert.equal(result.weaveReplaced, 1);
  const block = (result.messages[0].content as Array<Record<string, unknown>>)[0];
  assert.equal(block.content, '[weave skeleton]');
  assert.deepEqual(skeletonsServed, ['src/lib.rs']);
});

test('runSmartContext: weave miss falls back to the built-in outline', async () => {
  // >512KB so the size gate lets it through to outlining
  const lines = Array.from({ length: 40_000 }, (_, i) => `pub fn filler_${i}() {}`).join('\n');
  const messages: Message[] = [toolResult(lines, 'src/big.rs')];
  const result = await runSmartContext(messages, 512_000, {
    skeleton: async () => undefined,
  });
  assert.equal(result.replaced, 1);
  assert.equal(result.weaveReplaced, 0);
  const block = (result.messages[0].content as Array<Record<string, unknown>>)[0];
  assert.ok(String(block.content).startsWith('[AST Outline'), String(block.content).slice(0, 40));
});

test('runSmartContext: non-Rust files skip weave entirely', async () => {
  const js = Array.from({ length: 30_000 }, (_, i) => `const v${i} = ${i};`).join('\n');
  const messages: Message[] = [toolResult(js, 'src/app.js')];
  let weaveCalls = 0;
  const result = await runSmartContext(messages, 512_000, {
    skeleton: async () => {
      weaveCalls++;
      return '[should not be used]';
    },
  });
  assert.equal(weaveCalls, 0);
  assert.equal(result.weaveReplaced, 0);
  assert.equal(result.replaced, 1);
});

// ── session stats ─────────────────────────────────────────────────────────────

test('weave session stats accumulate across queries', async () => {
  const repo = tempRepo();
  const query = createWeaveQuery({ roots: [repo], runner: fakeRunner({ stdout: SKELETON_JSON }).runner })!;
  // Session counters are global — assert deltas, not absolute values.
  const before = getWeaveSessionStats();
  await query.skeleton('src/lib.rs', 4000);
  const after = getWeaveSessionStats();
  assert.equal(after.replacements - before.replacements, 1);
  assert.equal(after.rawBytes - before.rawBytes, 4000);
  assert.equal(after.skeletonTokens - before.skeletonTokens, 12);
});

test('createWeaveQuery: level option is forwarded to the CLI', async () => {
  const repo = tempRepo();
  const { runner, calls } = fakeRunner({ stdout: SKELETON_JSON });
  const query = createWeaveQuery({ roots: [repo], runner, level: 3 })!;
  await query.skeleton('src/lib.rs');
  assert.ok(calls[0].includes('--level'), 'level flag missing');
  assert.ok(calls[0].includes('3'), 'level value missing');
});
