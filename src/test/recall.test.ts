import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { testConfig, testWorkspace } from './helpers/mock-vscode';
import { runPipeline } from '../proxy/pipeline';
import {
  selectRecall, readMemorySummaries, prependSystemText, lastUserText, isFirstTurn, meaningfulWords, recallNote,
} from '../modules/recall';
import { Message } from '../proxy/types';

afterEach(() => {
  for (const key of Object.keys(testConfig)) delete testConfig[key];
  testWorkspace.workspaceFolders = undefined;
});

const summaries = [
  { ts: 1, summary: 'Refactored the payment webhook handler and added signature checks' },
  { ts: 2, summary: 'Fixed a flaky test in the calendar sync module' },
  { ts: 3, summary: 'Discussed naming for the billing webhook retries' },
];

test('words: words under four letters and stop words are not counted', () => {
  assert.deepEqual([...meaningfulWords('Fix the bug in this webhook')].sort(), ['webhook']);
});

test('select: summaries sharing the most words with the request come first, and the count is capped', () => {
  // "payment webhook signature": summary 1 shares all three, summary 3 shares one
  const picked = selectRecall(summaries, 'payment webhook signature', 2);
  assert.deepEqual(picked.map((s) => s.ts), [1, 3]);

  const capped = selectRecall(summaries, 'payment webhook signature', 1);
  assert.deepEqual(capped.map((s) => s.ts), [1]);
});

test('select: a summary sharing too little of the request is not recalled', () => {
  // Only "calendar" overlaps, one word in six: 0.17, under the 0.2 floor
  const picked = selectRecall(summaries, 'calendar invoices vacation hotels flights monitoring');
  assert.deepEqual(picked, []);
});

test('select: a request with no meaningful words recalls nothing', () => {
  assert.deepEqual(selectRecall(summaries, 'hi there'), []);
});

test('first turn: a conversation with one user message is new; a later one is not', () => {
  assert.equal(isFirstTurn([{ role: 'user', content: 'a' }]), true);
  assert.equal(isFirstTurn([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'c' }]), false);
});

test('last user text: tool results and assistant turns are skipped', () => {
  const messages = [
    { role: 'user', content: 'the real question' },
    { role: 'assistant', content: 'working' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'file contents' }] },
  ] as unknown as Message[];
  assert.equal(lastUserText(messages), 'the real question');
});

test('prepend: an Anthropic system prompt gets the note in front, as a string or as blocks', () => {
  const asString = prependSystemText({ system: 'base' }, 'anthropic', 'NOTE');
  assert.equal(asString.system, 'NOTE\n\nbase');
  const asBlocks = prependSystemText({ system: [{ type: 'text', text: 'base' }] }, 'anthropic', 'NOTE');
  assert.deepEqual(asBlocks.system, [{ type: 'text', text: 'NOTE' }, { type: 'text', text: 'base' }]);
  assert.equal(prependSystemText({}, 'anthropic', 'NOTE').system, 'NOTE');
});

test('prepend: an OpenAI system message gets the note in front, or one is added', () => {
  const existing = prependSystemText({ messages: [{ role: 'system', content: 'base' }, { role: 'user', content: 'x' }] }, 'openai', 'NOTE');
  assert.equal((existing.messages as Message[])[0].content, 'NOTE\n\nbase');
  const added = prependSystemText({ messages: [{ role: 'user', content: 'x' }] }, 'openai', 'NOTE');
  assert.deepEqual((added.messages as Message[])[0], { role: 'system', content: 'NOTE' });
});

test('note: the recalled text is labelled as possibly not applicable', () => {
  const note = recallNote([{ ts: 1, summary: 'Did a thing' }]);
  assert.match(note, /may not apply/);
  assert.match(note, /- Did a thing/);
});

test('memory file: the summaries are read, and a corrupt file gives none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-recall-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  assert.deepEqual(readMemorySummaries(), []);

  fs.mkdirSync(path.join(dir, '.tpt'));
  fs.writeFileSync(path.join(dir, '.tpt', 'memory.json'), JSON.stringify({ summaries: [{ ts: 5, summary: 'kept' }, { ts: 'bad', summary: 1 }] }));
  assert.deepEqual(readMemorySummaries(), [{ ts: 5, summary: 'kept' }]);

  fs.writeFileSync(path.join(dir, '.tpt', 'memory.json'), '{not json');
  assert.deepEqual(readMemorySummaries(), []);
});

test('pipeline: with recall on, a new conversation gets the matching summary in its system prompt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-recall-pipe-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  fs.mkdirSync(path.join(dir, '.tpt'));
  fs.writeFileSync(path.join(dir, '.tpt', 'memory.json'), JSON.stringify({ summaries: summaries }));
  testConfig['memoryWeaver.recall.enabled'] = true;
  testConfig['router.enabled'] = false;
  testConfig['tokenShield.enabled'] = false;

  const result = await runPipeline({
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'why does the payment webhook retry fail' }] },
    format: 'openai',
    sessionToken: 'test',
  } as never);

  const system = (result.body as { messages: Message[] }).messages[0];
  assert.equal(system.role, 'system');
  assert.match(String(system.content), /Refactored the payment webhook/);
  assert.ok(result.moduleActions.some((a) => a.startsWith('memoryRecall:')));
  assert.ok(result.stageTokens.some((s) => s.stage === 'memoryRecall'));
});

test('pipeline: with recall off (the default), the prompt is not changed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-recall-off-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  fs.mkdirSync(path.join(dir, '.tpt'));
  fs.writeFileSync(path.join(dir, '.tpt', 'memory.json'), JSON.stringify({ summaries: summaries }));
  testConfig['router.enabled'] = false;
  testConfig['tokenShield.enabled'] = false;

  const result = await runPipeline({
    method: 'POST',
    path: '/v1/chat/completions',
    headers: {},
    body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'why does the payment webhook retry fail' }] },
    format: 'openai',
    sessionToken: 'test',
  } as never);

  assert.equal((result.body as { messages: Message[] }).messages.length, 1);
});
