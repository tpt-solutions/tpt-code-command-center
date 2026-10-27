import { StageTokens } from './inspectStore';

// How one stage changed the request's estimated size: tokens it removed, and tokens it added
export interface StageEffect {
  stage: string;
  saved: number;
  added: number;
}

// Each stage is charged with the change from the stage before it. A stage that removed tokens
// saved them; one that added tokens (Silent Edit's schema, for one) cost them.
export function attributeStages(stages: StageTokens[]): StageEffect[] {
  const effects: StageEffect[] = [];
  for (let i = 1; i < stages.length; i++) {
    const change = stages[i].tokens - stages[i - 1].tokens;
    effects.push({
      stage: stages[i].stage,
      saved: change < 0 ? -change : 0,
      added: change > 0 ? change : 0,
    });
  }
  return effects;
}

// One line per stage: its size, and how much the stage changed it from the stage before.
// A negative change is a saving; a positive one is a cost the module added (Silent Edit's schema, for one).
export function formatStageSavings(stages: StageTokens[]): string[] {
  if (stages.length === 0) return ['(no stage counts recorded)'];
  const lines: string[] = [];
  let previous: number | undefined;
  for (const { stage, tokens } of stages) {
    const change = previous === undefined ? '' : `  (${tokens - previous >= 0 ? '+' : ''}${tokens - previous})`;
    lines.push(`${stage.padEnd(14)} ${String(tokens).padStart(8)} tokens${change}`);
    previous = tokens;
  }
  const first = stages[0].tokens;
  const last = stages[stages.length - 1].tokens;
  const net = last - first;
  const pct = first > 0 ? ` (${((net / first) * 100).toFixed(1)}%)` : '';
  lines.push(`Net change: ${net >= 0 ? '+' : ''}${net} tokens${pct}`);
  return lines;
}

export interface ModuleSavings {
  module: string;
  saved: number;
  added: number;
  requests: number;
}

// Sums the per-stage effects of many requests into one row per module, largest saving first
export function sumModuleSavings(perRequest: StageTokens[][]): ModuleSavings[] {
  const totals = new Map<string, ModuleSavings>();
  for (const stages of perRequest) {
    for (const effect of attributeStages(stages)) {
      const row = totals.get(effect.stage) ?? { module: effect.stage, saved: 0, added: 0, requests: 0 };
      row.saved += effect.saved;
      row.added += effect.added;
      if (effect.saved > 0 || effect.added > 0) row.requests++;
      totals.set(effect.stage, row);
    }
  }
  return [...totals.values()].sort((a, b) => b.saved - a.saved || a.module.localeCompare(b.module));
}

// The name a user knows a pipeline stage by
const STAGE_LABELS: Record<string, string> = {
  vault: 'Vault',
  memoryWeaver: 'Memory Weaver',
  smartContext: 'Smart Context',
  silentEdit: 'Silent Edit',
  translate: 'Translation',
  memoryRecall: 'Memory Recall',
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

// The shareable savings report, as Markdown. Every figure is an estimate; the report says so.
export function renderSavingsReport(input: { period: string; modules: ModuleSavings[]; measuredRequests: number }): string {
  const totalSaved = input.modules.reduce((n, m) => n + m.saved, 0);
  const totalAdded = input.modules.reduce((n, m) => n + m.added, 0);
  const rows = input.modules.map((m) => `| ${stageLabel(m.module)} | ${m.saved} | ${m.added} | ${m.requests} |`);
  if (rows.length === 0) rows.push('| (no changes measured) | 0 | 0 | 0 |');
  return [
    `# TPT token savings: ${input.period}`,
    '',
    `Measured requests: ${input.measuredRequests}`,
    '',
    'All figures are estimates. Each stage is measured as characters ÷ 4 of the request body before and after the module ran. They are not billed tokens; the provider\'s own usage figures are in the request ledger.',
    '',
    '| Module | Tokens removed | Tokens added | Requests changed |',
    '| --- | ---: | ---: | ---: |',
    ...rows,
    '',
    `Net removed: ${totalSaved - totalAdded} tokens`,
    '',
  ].join('\n');
}

// Settings suggestions read from the ledger. They say what the history shows and never change a setting.
export const MIN_TUNING_SAMPLE = 20;
// The built-in router rule sends requests of this size or less to a cheaper model
const SHORT_REQUEST_TOKENS = 2000;

export interface TuningSample {
  originals: number[];
  memorySummarisedRequests: number;
}

export interface TuningSettings {
  memoryEnabled: boolean;
  memoryThreshold: number;
  routerEnabled: boolean;
}

export function tuningSuggestions(sample: TuningSample, settings: TuningSettings): string[] {
  const n = sample.originals.length;
  if (n < MIN_TUNING_SAMPLE) {
    return [`Only ${n} measured request(s) so far. ${MIN_TUNING_SAMPLE} are needed before a suggestion is made.`];
  }
  const pct = (count: number, of: number) => `${Math.round((count / of) * 100)}%`;
  const out: string[] = [];

  const over = sample.originals.filter((t) => t > settings.memoryThreshold).length;
  if (over > 0 && over / n >= 0.1) {
    if (!settings.memoryEnabled) {
      out.push(`${pct(over, n)} of requests are over the Memory Weaver threshold (${settings.memoryThreshold} tokens), and Memory Weaver is off. Turn on tpt.memoryWeaver.enabled to keep long conversations in check.`);
    } else if (sample.memorySummarisedRequests / over < 0.5) {
      out.push(`${pct(over, n)} of requests are over the Memory Weaver threshold (${settings.memoryThreshold} tokens), but only ${sample.memorySummarisedRequests} were summarised. Check tpt.memoryWeaver.fallbackOrder and the summariser (Ollama or the proxy model).`);
    }
  }

  if (!settings.routerEnabled) {
    const short = sample.originals.filter((t) => t <= SHORT_REQUEST_TOKENS).length;
    if (short / n >= 0.5) {
      out.push(`${pct(short, n)} of requests are at most ${SHORT_REQUEST_TOKENS} tokens. The built-in router rule can send those to a cheaper model: try tpt.router.enabled, then compare Cost by Model in the dashboard. Dry run measures size, not the model that answers, so it cannot show this.`);
    }
  }

  if (out.length === 0) out.push('No change suggested by the measured requests.');
  return out;
}
