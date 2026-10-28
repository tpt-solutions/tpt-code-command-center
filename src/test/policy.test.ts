import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { testWorkspace } from './helpers/mock-vscode';
import {
  parsePolicy, tightenLimit, applyPolicy, readWorkspacePolicy, setTrustedPolicyHashes,
  applyWorkspacePolicy, markPolicyTrusted, POLICY_FILE, readPolicyState, describePolicyState,
} from '../modules/policy';
import type { TptConfig } from '../utils/config';

afterEach(() => {
  testWorkspace.workspaceFolders = undefined;
  setTrustedPolicyHashes([]);
});

// Only the fields the policy touches, plus a router the policy must not change
const config = (): TptConfig => ({
  dryRun: false,
  upstreamProvider: 'openrouter',
  vault: { enabled: true, customRegex: ['user-pattern'] },
  costBudget: { dailyLimitUsd: 0, monthlyLimitUsd: 50, hardStop: false, quotaPollingIntervalSec: 180 },
  router: { enabled: true, rules: [{ match: { maxTokens: 100 }, model: 'mine', provider: 'openrouter' }] },
} as unknown as TptConfig);

test('parse: known fields are kept, the wrong types are dropped, and a non-object is refused', () => {
  assert.deepEqual(parsePolicy({
    vault: { customRegex: ['a', 3, 'b'] },
    costBudget: { dailyLimitUsd: 5, monthlyLimitUsd: -1 },
    dryRun: 'yes',
    router: { rules: [{ provider: 'attacker' }] },
  }), {
    vault: { customRegex: ['a', 'b'] },
    costBudget: { dailyLimitUsd: 5, monthlyLimitUsd: undefined },
  });
  assert.equal(parsePolicy(null), undefined);
  assert.equal(parsePolicy([1, 2]), undefined);
});

test('tighten: a policy budget lowers a looser setting, and replaces "no limit"', () => {
  assert.equal(tightenLimit(0, 10), 10, 'no limit becomes the policy limit');
  assert.equal(tightenLimit(20, 10), 10, 'a looser setting is lowered');
  assert.equal(tightenLimit(5, 10), 5, 'a stricter setting is kept');
  assert.equal(tightenLimit(5, undefined), 5);
  assert.equal(tightenLimit(5, 0), 5, 'a policy of zero does not remove a limit');
});

test('apply: adds Vault patterns, lowers budgets and turns dry run on; never touches the router or provider', () => {
  const out = applyPolicy(config(), {
    vault: { customRegex: ['team-key-[0-9]+'] },
    costBudget: { dailyLimitUsd: 2 },
    dryRun: true,
  });
  assert.deepEqual(out.vault.customRegex, ['user-pattern', 'team-key-[0-9]+']);
  assert.equal(out.costBudget.dailyLimitUsd, 2);
  assert.equal(out.costBudget.monthlyLimitUsd, 50);
  assert.equal(out.dryRun, true);
  assert.deepEqual(out.router, config().router);
  assert.equal(out.upstreamProvider, 'openrouter');
});

test('policy file: it is read from the workspace root and hashed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-policy-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  fs.writeFileSync(path.join(dir, POLICY_FILE), JSON.stringify({ dryRun: true }));

  const loaded = readWorkspacePolicy();
  assert.ok(loaded);
  assert.equal(loaded.policy.dryRun, true);
  assert.match(loaded.hash, /^[0-9a-f]{64}$/);
});

test('trust: an untrusted policy changes nothing; the same file once trusted applies', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-policy-trust-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  fs.writeFileSync(path.join(dir, POLICY_FILE), JSON.stringify({ dryRun: true }));
  const { hash } = readWorkspacePolicy()!;

  const untrusted = applyWorkspacePolicy(config());
  assert.equal(untrusted.dryRun, false, 'not trusted: the policy is not applied');

  markPolicyTrusted(hash);
  const trusted = applyWorkspacePolicy(config());
  assert.equal(trusted.dryRun, true, 'trusted: the policy is applied');
});

test('trust: a changed policy file has a new hash and is not trusted until the user trusts it again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-policy-change-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  const file = path.join(dir, POLICY_FILE);
  fs.writeFileSync(file, JSON.stringify({ dryRun: false }));
  const first = readWorkspacePolicy()!.hash;
  setTrustedPolicyHashes([first]);

  fs.writeFileSync(file, JSON.stringify({ dryRun: true }));
  const second = readWorkspacePolicy()!;
  assert.notEqual(second.hash, first);
  assert.equal(applyWorkspacePolicy(config()).dryRun, false, 'the changed file is not applied until trusted');
});

test('state: no file, a broken file and a loaded file are told apart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-policy-state-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  const file = path.join(dir, POLICY_FILE);
  assert.equal(readPolicyState().kind, 'none');

  fs.writeFileSync(file, '{ not json');
  assert.equal(readPolicyState().kind, 'broken', 'invalid JSON is broken');
  assert.equal(readWorkspacePolicy(), undefined, 'a broken file is never applied');

  fs.writeFileSync(file, JSON.stringify([1, 2]));
  assert.equal(readPolicyState().kind, 'broken', 'a non-object top level is broken');

  fs.writeFileSync(file, JSON.stringify({ dryRun: true }));
  assert.equal(readPolicyState().kind, 'loaded');
});

test('describe: an untrusted policy says it is not applied; a broken one says it is ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-policy-describe-'));
  testWorkspace.workspaceFolders = [{ uri: { fsPath: dir } }];
  fs.writeFileSync(path.join(dir, POLICY_FILE), JSON.stringify({ dryRun: true, costBudget: { dailyLimitUsd: 2 } }));
  const state = readPolicyState();

  const untrusted = describePolicyState(state, false).join('\n');
  assert.match(untrusted, /Trusted: no/);
  assert.match(untrusted, /Daily budget: 2/);
  assert.match(untrusted, /Monthly budget: not set/);
  assert.match(untrusted, /Dry run: on/);

  assert.match(describePolicyState(state, true).join('\n'), /Trusted: yes/);
  assert.match(describePolicyState({ kind: 'broken', file: 'x' }, false).join('\n'), /ignored/);
  assert.match(describePolicyState({ kind: 'none' }, false).join('\n'), /Nothing is applied/);
});
