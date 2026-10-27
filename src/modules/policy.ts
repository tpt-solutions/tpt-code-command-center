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

// The policy file in the first workspace folder, read again only when it changes on disk
let cache: { file: string; mtimeMs: number; size: number; loaded?: LoadedPolicy } | undefined;

export function readWorkspacePolicy(): LoadedPolicy | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const file = path.join(folders[0].uri.fsPath, POLICY_FILE);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    cache = undefined;
    return undefined;
  }
  if (cache && cache.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
    return cache.loaded;
  }

  let loaded: LoadedPolicy | undefined;
  try {
    const bytes = fs.readFileSync(file);
    const policy = parsePolicy(JSON.parse(bytes.toString('utf8')));
    if (policy) loaded = { policy, hash: crypto.createHash('sha256').update(bytes).digest('hex') };
  } catch {
    loaded = undefined; // a broken policy file is ignored, and a warning is shown at activation
  }
  cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, loaded };
  return loaded;
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
