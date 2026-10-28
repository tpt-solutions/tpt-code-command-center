import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { TptConfig } from '../utils/config';

// A team's shared settings, committed to the repository. It lives at the root, not in .tpt/,
// because .tpt/ is git-ignored and could not be shared.
//
// A policy can only tighten: it adds Vault patterns, lowers cost budgets, and turns dry run on.
// It cannot add router rules or change the provider, since that would let a repository send a
// developer's code somewhere they did not choose. It applies only after the user trusts that
// exact file (identified by its hash), so a cloned repository cannot change settings silently.
export const POLICY_FILE = 'tpt-policy.json';

export interface WorkspacePolicy {
  vault?: { customRegex?: string[] };
  costBudget?: { dailyLimitUsd?: number; monthlyLimitUsd?: number };
  dryRun?: boolean;
}

export interface LoadedPolicy {
  policy: WorkspacePolicy;
  hash: string;
}

// Keeps only the fields the policy may set, with the types it needs. Anything else is ignored.
export function parsePolicy(raw: unknown): WorkspacePolicy | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const policy: WorkspacePolicy = {};

  const vault = r.vault as Record<string, unknown> | undefined;
  if (vault && Array.isArray(vault.customRegex)) {
    policy.vault = { customRegex: vault.customRegex.filter((p): p is string => typeof p === 'string') };
  }
  const budget = r.costBudget as Record<string, unknown> | undefined;
  if (budget) {
    const limit = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
    const daily = limit(budget.dailyLimitUsd);
    const monthly = limit(budget.monthlyLimitUsd);
    if (daily !== undefined || monthly !== undefined) {
      policy.costBudget = { dailyLimitUsd: daily, monthlyLimitUsd: monthly };
    }
  }
  if (typeof r.dryRun === 'boolean') policy.dryRun = r.dryRun;
  return policy;
}

// The policy setting a value only ever lowers a budget: 0 means no limit, which a policy can replace
export function tightenLimit(user: number, policy: number | undefined): number {
  if (policy === undefined || policy <= 0) return user;
  return user > 0 ? Math.min(user, policy) : policy;
}

// Pure: the config with a policy applied. Used only for a trusted policy.
export function applyPolicy(config: TptConfig, policy: WorkspacePolicy): TptConfig {
  return {
    ...config,
    dryRun: config.dryRun || policy.dryRun === true,
    vault: {
      ...config.vault,
      customRegex: [...config.vault.customRegex, ...(policy.vault?.customRegex ?? [])],
    },
    costBudget: {
      ...config.costBudget,
      dailyLimitUsd: tightenLimit(config.costBudget.dailyLimitUsd, policy.costBudget?.dailyLimitUsd),
      monthlyLimitUsd: tightenLimit(config.costBudget.monthlyLimitUsd, policy.costBudget?.monthlyLimitUsd),
    },
  };
}

// What the policy file in the workspace root is: absent, unreadable (ignored, with a warning), or loaded
export type PolicyState =
  | { kind: 'none' }
  | { kind: 'broken'; file: string }
  | { kind: 'loaded'; file: string; loaded: LoadedPolicy };

// The policy file in the first workspace folder, read again only when it changes on disk
let cache: { file: string; mtimeMs: number; size: number; state: PolicyState } | undefined;

export function readPolicyState(): PolicyState {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return { kind: 'none' };
  const file = path.join(folders[0].uri.fsPath, POLICY_FILE);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache = undefined;
    return { kind: 'none' };
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return cache.state;
  }

  let state: PolicyState;
  try {
    const bytes = fs.readFileSync(file);
    const policy = parsePolicy(JSON.parse(bytes.toString('utf8')));
    state = policy
      ? { kind: 'loaded', file, loaded: { policy, hash: crypto.createHash('sha256').update(bytes).digest('hex') } }
      : { kind: 'broken', file };
  } catch {
    state = { kind: 'broken', file }; // ignored: the settings apply as if there were no policy
  }
  cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, state };
  return state;
}

export function readWorkspacePolicy(): LoadedPolicy | undefined {
  const state = readPolicyState();
  return state.kind === 'loaded' ? state.loaded : undefined;
}

// Plain-language lines for TPT: Show Workspace Policy. Pure, so the wording is tested.
export function describePolicyState(state: PolicyState, trusted: boolean): string[] {
  if (state.kind === 'none') {
    return [`No ${POLICY_FILE} in the workspace root. Nothing is applied from a policy.`];
  }
  if (state.kind === 'broken') {
    return [
      `${state.file} could not be read: it is not valid JSON, or its top level is not an object.`,
      'It is ignored, and the settings apply as if there were no policy.',
    ];
  }
  const { policy, hash } = state.loaded;
  const lines = [
    `${state.file} found (sha256 ${hash.slice(0, 12)}…).`,
    trusted
      ? 'Trusted: yes. The policy below is applied to every request.'
      : 'Trusted: no. The policy below is NOT applied until you trust this file (the next activation asks).',
  ];
  const patterns = policy.vault?.customRegex?.length ?? 0;
  lines.push(`  Vault patterns added: ${patterns}`);
  lines.push(`  Daily budget: ${policy.costBudget?.dailyLimitUsd ?? 'not set'}`);
  lines.push(`  Monthly budget: ${policy.costBudget?.monthlyLimitUsd ?? 'not set'}`);
  lines.push(`  Dry run: ${policy.dryRun === true ? 'on' : 'not set'}`);
  return lines;
}

// Hashes of the policy files the user has trusted, loaded from global state at activation
let trusted = new Set<string>();

export function setTrustedPolicyHashes(hashes: string[]): void {
  trusted = new Set(hashes);
}

export function isPolicyTrusted(loaded: LoadedPolicy): boolean {
  return trusted.has(loaded.hash);
}

export function markPolicyTrusted(hash: string): string[] {
  trusted.add(hash);
  return [...trusted];
}

// The config every request uses: the settings, tightened by a policy the user has trusted
export function applyWorkspacePolicy(config: TptConfig): TptConfig {
  const loaded = readWorkspacePolicy();
  if (!loaded || !isPolicyTrusted(loaded)) return config;
  return applyPolicy(config, loaded.policy);
}
