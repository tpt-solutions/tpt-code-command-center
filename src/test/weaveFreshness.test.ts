import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createWeaveQuery, Runner } from '../modules/weave';

function tempRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-weave-fresh-'));
  fs.mkdirSync(path.join(dir, '.tpt-weave'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.tpt-weave', 'manifest.toml'), '[repository]\nname = "fixture"\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'lib.rs'), 'pub fn add(a: i32, b: i32) -> i32 { a + b }\n');
  return dir;
}

test('weave: an unchanged file is served from the skeleton cache', async () => {
  const dir = tempRepo();
  let calls = 0;
  const runner: Runner = async () => {
    calls++;
    return { stdout: JSON.stringify({ text: `skeleton ${calls}`, token_estimate: 5 }) };
  };
  const query = createWeaveQuery({ roots: [dir], runner })!;

  await query.skeleton('src/lib.rs', 100);
  const again = await query.skeleton('src/lib.rs', 100);

  assert.equal(calls, 1);
  assert.equal(again, 'skeleton 1');
});

test('weave: an edited file gets a fresh skeleton, not the cached one', async () => {
  const dir = tempRepo();
  let calls = 0;
  const runner: Runner = async () => {
    calls++;
    return { stdout: JSON.stringify({ text: `skeleton ${calls}`, token_estimate: 5 }) };
  };
  const query = createWeaveQuery({ roots: [dir], runner })!;
  await query.skeleton('src/lib.rs', 100);

  // Edit the file and move its mtime forward so the change is visible to the cache key
  const file = path.join(dir, 'src', 'lib.rs');
  fs.writeFileSync(file, 'pub fn changed() {}\n');
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);

  const after = await query.skeleton('src/lib.rs', 100);

  assert.equal(calls, 2);
  assert.equal(after, 'skeleton 2');
});
