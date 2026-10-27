import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { log } from '../utils/logger';

// tpt-weave integration (todo.md Phase 12 / spec.md §32): when a workspace
// has been indexed with `tpt-weave adopt`, per-file outlining is routed
// through the tpt-weave CLI instead of re-parsing sources here. tpt-weave
// only understands Rust today, so non-`.rs` files keep the tree-sitter /
// regex outline path. Every weave failure falls back — the pipeline must
// never break because of the CLI.

export interface WeaveSkeleton {
  path: string;
  level: string;
  token_estimate: number;
  text: string;
}

/** Subset of `tpt-weave stats --json` the dashboard renders. */
export interface WeaveRepoStats {
  repository: string;
  files: number;
  symbols: number;
  rawTokens: number;
  selectedTokens: number;
  savedTokens: number;
  reductionPct: number;
  cacheHitRate: number;
}

export interface WeaveSessionStats {
  replacements: number;
  rawBytes: number;
  skeletonTokens: number;
}

export interface WeaveQuery {
  /** Skeleton text for a workspace (relative or absolute) path, or undefined. */
  skeleton(relPath: string, rawBytes?: number): Promise<string | undefined>;
  /** Live repository stats for the first indexed root (60 s TTL). */
  repoStats(): Promise<WeaveRepoStats | undefined>;
  readonly roots: readonly string[];
}

export type Runner = (
  cmd: string,
  args: string[],
  timeoutMs: number,
) => Promise<{ stdout: string }>;

const DEFAULT_TIMEOUT_MS = 15_000;
const SKELETON_CACHE_MAX = 200;
const REPO_STATS_TTL_MS = 60_000;

// Session accumulation (dashboard "this session" figures)
const sessionStats: WeaveSessionStats = { replacements: 0, rawBytes: 0, skeletonTokens: 0 };

export function getWeaveSessionStats(): WeaveSessionStats {
  return { ...sessionStats };
}

function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text) / 4);
}

function defaultRunner(cmd: string, args: string[], timeoutMs: number): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout });
      }
    );
  });
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(root, candidate);
  // Only a leading ".." segment escapes the root; "..config" is an ordinary name
  const escapes = rel === '..' || rel.startsWith('..' + path.sep);
  return rel !== '' && !escapes && !path.isAbsolute(rel);
}

export function createWeaveQuery(opts: {
  cliPath?: string;
  roots: string[];
  runner?: Runner;
  timeoutMs?: number;
  /** Representation level for skeletons: 2 = signatures (default), 3 = skeleton. */
  level?: number;
}): WeaveQuery | undefined {
  const roots = opts.roots.filter((root) => {
    try {
      return fs.existsSync(path.join(root, '.tpt-weave', 'manifest.toml'));
    } catch {
      return false;
    }
  });
  if (roots.length === 0) return undefined;

  const cliPath = opts.cliPath || 'tpt-weave';
  const runner = opts.runner ?? defaultRunner;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const skeletonCache = new Map<string, string>();
  let repoStatsCache: { at: number; stats: WeaveRepoStats } | undefined;

  function findRoot(absolute: string): { root: string; rel: string } | undefined {
    for (const root of roots) {
      if (isInside(root, absolute)) {
        return { root, rel: toPosix(path.relative(root, absolute)) };
      }
    }
    return undefined;
  }

  function resolveTarget(relPath: string): { root: string; rel: string } | undefined {
    const cleaned = toPosix(relPath);
    if (path.isAbsolute(relPath)) return findRoot(relPath);
    for (const root of roots) {
      try {
        // A relative path such as "../../etc/x" must not reach a file outside the root
        const full = path.resolve(root, cleaned);
        if (!isInside(root, full)) continue;
        if (fs.existsSync(full)) return { root, rel: toPosix(path.relative(root, full)) };
      } catch {
        // unreachable root — try the next one
      }
    }
    return undefined;
  }

  // The CLI consumes the first argument after the subcommand as the path,
  // so flags must follow it.
  function skeletonArgs(rel: string): string[] {
    const args = ['skeleton', rel, '--json'];
    if (opts.level !== undefined) args.push('--level', String(opts.level));
    return args;
  }

  async function query(queryRoot: string, args: string[]): Promise<string | undefined> {
    try {
      const { stdout } = await runner(cliPath, ['--path', queryRoot, ...args], timeoutMs);
      return stdout;
    } catch (err) {
      log(`tpt-weave query failed (${args.join(' ')}): ${err instanceof Error ? err.message : err}`);
      return undefined;
    }
  }

  const queryObj: WeaveQuery = {
    roots,

    async skeleton(relPath: string, rawBytes?: number): Promise<string | undefined> {
      const target = resolveTarget(relPath);
      if (!target) return undefined;
      const key = `${target.root}|${target.rel}`;
      const cached = skeletonCache.get(key);
      if (cached !== undefined) {
        sessionStats.replacements++;
        sessionStats.rawBytes += rawBytes ?? 0;
        sessionStats.skeletonTokens += estimateTokens(cached);
        return cached;
      }

      const stdout = await query(target.root, skeletonArgs(target.rel));
      if (stdout === undefined) return undefined;
      let skeleton: WeaveSkeleton;
      try {
        skeleton = JSON.parse(stdout) as WeaveSkeleton;
      } catch {
        return undefined;
      }
      if (typeof skeleton.text !== 'string' || skeleton.text.length === 0) return undefined;

      sessionStats.replacements++;
      sessionStats.rawBytes += rawBytes ?? 0;
      sessionStats.skeletonTokens += skeleton.token_estimate || estimateTokens(skeleton.text);

      if (skeletonCache.size >= SKELETON_CACHE_MAX) {
        const oldest = skeletonCache.keys().next().value;
        if (oldest !== undefined) skeletonCache.delete(oldest);
      }
      skeletonCache.set(key, skeleton.text);
      return skeleton.text;
    },

    async repoStats(): Promise<WeaveRepoStats | undefined> {
      if (repoStatsCache && Date.now() - repoStatsCache.at < REPO_STATS_TTL_MS) {
        return repoStatsCache.stats;
      }
      const stdout = await query(roots[0], ['stats', '--json']);
      if (stdout === undefined) return undefined;
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(stdout) as Record<string, unknown>;
      } catch {
        return undefined;
      }
      const overview = parsed.overview as Record<string, unknown> | undefined;
      const context = parsed.context as Record<string, unknown> | undefined;
      const tokens = context?.tokens as Record<string, unknown> | undefined;
      const cache = parsed.cache as Record<string, unknown> | undefined;
      if (!overview || !tokens) return undefined;
      const rawTokens = Number(tokens.raw_tokens ?? 0);
      const selectedTokens = Number(tokens.selected_tokens ?? 0);
      const stats: WeaveRepoStats = {
        repository: String(overview.repository ?? '?'),
        files: Number(overview.files ?? 0),
        symbols: Number(overview.symbols ?? 0),
        rawTokens,
        selectedTokens,
        savedTokens: Number(tokens.saved_tokens ?? Math.max(0, rawTokens - selectedTokens)),
        reductionPct: rawTokens > 0 ? ((rawTokens - selectedTokens) / rawTokens) * 100 : 0,
        cacheHitRate: Number(cache?.hit_rate ?? 0),
      };
      repoStatsCache = { at: Date.now(), stats };
      return stats;
    },
  };

  return queryObj;
}

/** Everything the dashboard needs, or undefined when weave is off/unavailable. */
export async function weaveDashboardSnapshot(
  cliPath: string,
  roots: string[],
  level?: number
): Promise<{ repo: WeaveRepoStats; session: WeaveSessionStats } | undefined> {
  const query = createWeaveQuery({ cliPath, roots, level });
  if (!query) return undefined;
  const repo = await query.repoStats();
  if (!repo) return undefined;
  return { repo, session: getWeaveSessionStats() };
}