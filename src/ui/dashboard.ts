import * as vscode from 'vscode';
import { getStats, getModelBreakdown, getMonthlyStats, LedgerStats, ModelStat, MonthStat } from '../ledger/ledger';
import { getProxyUrl } from '../proxy/server';
import { hasConnected } from '../utils/connection';
import { getConfig, resolveUpstreamUrl, workspaceRoots } from '../utils/config';
import { getQuotaSnapshot, QuotaSnapshot } from '../modules/quotaTracker';
import { weaveDashboardSnapshot, WeaveRepoStats, WeaveSessionStats } from '../modules/weave';

let panel: vscode.WebviewPanel | undefined;

export function showDashboard(context: vscode.ExtensionContext): void {
  if (panel) {
    panel.reveal();
    return;
  }

  panel = vscode.window.createWebviewPanel(
    'tpt.dashboard',
    'TPT Dashboard',
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [],
      enableCommandUris: true,
    }
  );

  panel.onDidDispose(() => { panel = undefined; }, undefined, context.subscriptions);
  refreshDashboard().catch((err) => {
    const logger = require('../utils/logger');
    logger.log(`Dashboard render error: ${err}`);
  });
}

export async function refreshDashboard(): Promise<void> {
  if (!panel) return;
  const [stats, modelBreakdown, monthlyStats] = await Promise.all([
    getStats(),
    getModelBreakdown(),
    getMonthlyStats(12),
  ]);
  const config = getConfig();
  const proxyUrl = getProxyUrl();
  const quota = getQuotaSnapshot();
  const weave = config.weave.enabled
    ? await weaveDashboardSnapshot(config.weave.cliPath, workspaceRoots(), config.weave.level).catch(() => undefined)
    : undefined;
  panel.webview.html = buildHtml(stats, modelBreakdown, monthlyStats, config, proxyUrl, quota, weave);
}

function buildHtml(
  stats: LedgerStats,
  modelBreakdown: ModelStat[],
  monthlyStats: MonthStat[],
  config: ReturnType<typeof getConfig>,
  proxyUrl: string | undefined,
  quota: QuotaSnapshot | undefined,
  weave: { repo: WeaveRepoStats; session: WeaveSessionStats } | undefined,
): string {
  const nonce = Math.random().toString(36).substring(2);

  const modules = [
    { name: 'Vault', enabled: config.vault.enabled, icon: '🛡️' },
    { name: 'Smart Context', enabled: config.smartContext.enabled, icon: '🌳' },
    { name: 'Weave (tpt-weave)', enabled: config.weave.enabled, icon: '🕸️' },
    { name: 'Token Shield', enabled: config.tokenShield.enabled, icon: '💾' },
    { name: 'Memory Weaver', enabled: config.memoryWeaver.enabled, icon: '🧵' },
    { name: 'Router', enabled: config.router.enabled, icon: '🔀' },
    { name: 'Silent Edit', enabled: config.silentEdit.enabled, icon: '✏️' },
    { name: 'Forge', enabled: config.forge.autoUpdate, icon: '🔨' },
  ];

  const moduleRows = modules
    .map((m) => `<tr><td>${m.icon} ${m.name}</td><td class="${m.enabled ? 'on' : 'off'}">${m.enabled ? '● ON' : '○ OFF'}</td></tr>`)
    .join('');

  const dayRows = stats.last7Days
    .map((d) => `<tr><td>${d.date}</td><td>${d.tokensIn.toLocaleString()}</td><td>${d.tokensOut.toLocaleString()}</td><td>$${d.costUsd.toFixed(4)}</td><td>${d.cacheHits}</td></tr>`)
    .join('');

  const modelRows = modelBreakdown
    .map((m) => `<tr><td style="font-family:monospace;font-size:11px">${m.model}</td><td>${m.requests.toLocaleString()}</td><td>${(m.tokensIn + m.tokensOut).toLocaleString()}</td><td>$${m.costUsd.toFixed(4)}</td></tr>`)
    .join('');

  const monthRows = monthlyStats
    .map((m) => `<tr><td>${m.month}</td><td>${m.tokensIn.toLocaleString()}</td><td>${m.tokensOut.toLocaleString()}</td><td>$${m.costUsd.toFixed(4)}</td><td>${m.cacheHits}</td><td style="color:#4caf50">$${m.savedUsd.toFixed(4)}</td></tr>`)
    .join('');

  // Savings hero
  const savingsPct = stats.totalCostUsd + stats.estimatedSavingsUsd > 0
    ? ((stats.estimatedSavingsUsd / (stats.totalCostUsd + stats.estimatedSavingsUsd)) * 100).toFixed(1)
    : '0.0';
  const hitRate = stats.totalRequests > 0
    ? ((stats.cacheHits / stats.totalRequests) * 100).toFixed(1)
    : '0.0';

  // Daily budget bar
  const dailyLimit = config.costBudget.dailyLimitUsd;
  const todaySpend = stats.last7Days[stats.last7Days.length - 1]?.costUsd ?? 0;
  const dailyBar = dailyLimit > 0
    ? `<div class="budget-bar-wrap"><div class="budget-bar-fill" style="width:${Math.min(100, (todaySpend / dailyLimit) * 100).toFixed(1)}%"></div></div>
       <div class="budget-label">Today: $${todaySpend.toFixed(4)} / $${dailyLimit.toFixed(2)} daily limit</div>`
    : '';

  // Monthly budget bar
  const monthlyLimit = config.costBudget.monthlyLimitUsd;
  const thisMonthSpend = stats.thisMonthCostUsd;
  const monthlyBar = monthlyLimit > 0
    ? `<div class="budget-bar-wrap" style="margin-top:6px"><div class="budget-bar-fill" style="width:${Math.min(100, (thisMonthSpend / monthlyLimit) * 100).toFixed(1)}%;background:var(--vscode-charts-orange, #ff9800)"></div></div>
       <div class="budget-label">This month: $${thisMonthSpend.toFixed(4)} / $${monthlyLimit.toFixed(2)} monthly limit</div>`
    : '';

  // Quota panel
  const quotaHtml = buildQuotaHtml(quota, config.upstreamProvider);

  // tpt-weave panel
  const weaveHtml = buildWeaveHtml(config, weave);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TPT Dashboard</title>
  <style nonce="${nonce}">
    body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; font-size: 13px; }
    h1 { font-size: 18px; margin: 0 0 16px; }
    h2 { font-size: 14px; margin: 16px 0 8px; border-bottom: 1px solid var(--vscode-widget-border); padding-bottom: 4px; }
    .stat-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 16px; }
    .stat { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 12px; }
    .stat-value { font-size: 22px; font-weight: bold; color: var(--vscode-textLink-foreground); }
    .stat-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px; }
    .proxy { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 10px 12px; margin-bottom: 16px; font-family: monospace; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 4px 8px; color: var(--vscode-descriptionForeground); border-bottom: 1px solid var(--vscode-widget-border); }
    td { padding: 4px 8px; border-bottom: 1px solid var(--vscode-widget-border); }
    .on { color: #4caf50; }
    .off { color: var(--vscode-descriptionForeground); }
    .badge-on { display: inline-block; background: #1b5e20; color: #a5d6a7; border-radius: 3px; padding: 1px 6px; font-size: 11px; }
    .badge-off { display: inline-block; background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); border-radius: 3px; padding: 1px 6px; font-size: 11px; }
    .budget-bar-wrap { height: 6px; background: var(--vscode-input-background); border-radius: 3px; overflow: hidden; margin-bottom: 4px; }
    .budget-bar-fill { height: 100%; background: var(--vscode-textLink-foreground); border-radius: 3px; transition: width 0.3s; }
    .budget-label { font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 4px; }
    .savings-hero { background: linear-gradient(135deg, #1b3a1b 0%, #1a2e3d 100%); border: 1px solid #4caf50; border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; }
    .savings-hero-title { font-size: 11px; color: #81c784; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }
    .savings-hero-row { display: flex; gap: 24px; align-items: baseline; flex-wrap: wrap; }
    .savings-hero-val { font-size: 20px; font-weight: bold; color: #a5d6a7; }
    .savings-hero-lbl { font-size: 11px; color: #81c784; }
    .savings-hero-sep { color: #2e7d32; font-size: 18px; }
    .quota-panel { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border); border-radius: 4px; padding: 12px; margin-top: 4px; }
    .quota-row { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
    .quota-label { color: var(--vscode-descriptionForeground); }
    .quota-val { font-weight: bold; }
    .quota-ts { font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
    .setup-guide { background: var(--vscode-input-background); border: 1px solid var(--vscode-editorWarning-foreground); border-radius: 6px; padding: 14px 16px; margin-bottom: 16px; }
    .setup-guide h3 { margin: 0 0 10px; font-size: 13px; color: var(--vscode-editorWarning-foreground); }
    .step { display: flex; gap: 10px; margin-bottom: 8px; font-size: 12px; line-height: 1.5; }
    .step-icon { flex-shrink: 0; width: 18px; }
    .step-ok { color: #4caf50; }
    .step-err { color: var(--vscode-editorWarning-foreground); }
    .step code { background: var(--vscode-textCodeBlock-background); padding: 0 4px; border-radius: 2px; font-size: 11px; }
    .step a { color: var(--vscode-textLink-foreground); }
  </style>
</head>
<body>
  <h1>🛡️ TPT Command Center</h1>

  <div class="proxy">
    Proxy: <strong>${proxyUrl ?? 'starting...'}</strong>
    &nbsp;|&nbsp; Suite: <span class="${config.enabled ? 'badge-on' : 'badge-off'}">${config.enabled ? 'ACTIVE' : 'BYPASSED'}</span>
    &nbsp;|&nbsp; This month: <strong>$${thisMonthSpend.toFixed(4)}</strong>
  </div>

  ${hasConnected() ? '' : buildSetupGuideHtml(config, proxyUrl)}

  <div class="savings-hero">
    <div class="savings-hero-title">✦ Estimated savings from TPT optimisation</div>
    <div class="savings-hero-row">
      <div>
        <div class="savings-hero-val">$${stats.estimatedSavingsUsd.toFixed(4)}</div>
        <div class="savings-hero-lbl">dollars saved</div>
      </div>
      <div class="savings-hero-sep">·</div>
      <div>
        <div class="savings-hero-val">${stats.tokensSaved.toLocaleString()}</div>
        <div class="savings-hero-lbl">tokens saved</div>
      </div>
      <div class="savings-hero-sep">·</div>
      <div>
        <div class="savings-hero-val">${hitRate}%</div>
        <div class="savings-hero-lbl">cache hit rate</div>
      </div>
      <div class="savings-hero-sep">·</div>
      <div>
        <div class="savings-hero-val">${savingsPct}%</div>
        <div class="savings-hero-lbl">of spend avoided</div>
      </div>
    </div>
  </div>

  <h2>Token Ledger</h2>
  <div class="stat-grid">
    <div class="stat">
      <div class="stat-value">${stats.totalRequests.toLocaleString()}</div>
      <div class="stat-label">Total requests</div>
    </div>
    <div class="stat">
      <div class="stat-value">${(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}</div>
      <div class="stat-label">Total tokens</div>
    </div>
    <div class="stat">
      <div class="stat-value">$${stats.totalCostUsd.toFixed(4)}</div>
      <div class="stat-label">Total cost (all time)</div>
    </div>
    <div class="stat">
      <div class="stat-value">$${thisMonthSpend.toFixed(4)}</div>
      <div class="stat-label">This month</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.cacheHits.toLocaleString()}</div>
      <div class="stat-label">Cache hits</div>
    </div>
    <div class="stat">
      <div class="stat-value">${stats.tokensSaved.toLocaleString()}</div>
      <div class="stat-label">Tokens saved</div>
    </div>
  </div>

  ${dailyBar}${monthlyBar}

  <h2>Last 7 Days</h2>
  <table>
    <thead><tr><th>Date</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th><th>Cache Hits</th></tr></thead>
    <tbody>${dayRows || '<tr><td colspan="5">No data yet</td></tr>'}</tbody>
  </table>

  <h2>Monthly History</h2>
  <table>
    <thead><tr><th>Month</th><th>Tokens In</th><th>Tokens Out</th><th>Cost</th><th>Cache Hits</th><th>Saved</th></tr></thead>
    <tbody>${monthRows || '<tr><td colspan="6">No data yet</td></tr>'}</tbody>
  </table>

  <h2>Cost by Model</h2>
  <table>
    <thead><tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr></thead>
    <tbody>${modelRows || '<tr><td colspan="4">No data yet</td></tr>'}</tbody>
  </table>

  <h2>Provider Quota</h2>
  ${quotaHtml}

  <h2>Repository Context (tpt-weave)</h2>
  ${weaveHtml}

  <h2>Modules</h2>
  <table>
    <thead><tr><th>Module</th><th>Status</th></tr></thead>
    <tbody>${moduleRows}</tbody>
  </table>
</body>
</html>`;
}

function buildSetupGuideHtml(
  config: ReturnType<typeof getConfig>,
  proxyUrl: string | undefined,
): string {
  const { apiKey } = resolveUpstreamUrl(config);
  const apiKeyOk = config.upstreamProvider === 'local' || apiKey.length > 0;
  const proxyOk = proxyUrl !== undefined;

  const apiKeyStep = apiKeyOk
    ? `<div class="step"><span class="step-icon step-ok">✅</span><span>API key configured for <code>${config.upstreamProvider}</code></span></div>`
    : `<div class="step"><span class="step-icon step-err">❌</span><span>No API key set for <code>${config.upstreamProvider}</code>. <a href="command:workbench.action.openSettings?%5B%22tpt%22%5D">Open Settings</a> and set <code>tpt.${config.upstreamProvider}ApiKey</code> (or change <code>tpt.upstreamProvider</code>).</span></div>`;

  const proxyStep = proxyOk
    ? `<div class="step"><span class="step-icon step-ok">✅</span><span>Proxy is running at <code>${proxyUrl}</code></span></div>`
    : `<div class="step"><span class="step-icon step-err">⚠️</span><span>Proxy is still starting. Check the <strong>TPT Command Center</strong> Output Channel for errors.</span></div>`;

  const url = proxyUrl ?? 'http://localhost:7331';

  return `<div class="setup-guide">
  <h3>⚡ Getting Started — no requests recorded yet</h3>
  ${apiKeyStep}
  ${proxyStep}
  <div class="step"><span class="step-icon">3️⃣</span><span>
    <strong>Connect your AI tool:</strong><br>
    <strong>Claude Code VS Code extension</strong> — in VS Code settings (<code>Ctrl+,</code>), search <code>claude apiBaseUrl</code> and set it to <code>${url}</code>. All requests flow: Claude Code → TPT proxy → Anthropic.<br>
    <strong>Claude Code CLI</strong> — open a <em>new</em> terminal inside VS Code (<code>ANTHROPIC_BASE_URL=${url}</code> is auto-injected) and run <code>claude</code> as normal.<br>
    <strong>Cline</strong> — Provider: <code>OpenAI Compatible</code> · Base URL: <code>${url}</code> · Add header: <code>X-TPT-Token: &lt;token from Output Channel&gt;</code>
  </span></div>
  <div class="step"><span class="step-icon">4️⃣</span><span>Send any message through your AI tool — this panel updates automatically.</span></div>
  <div class="step"><span class="step-icon">💡</span><span>
    <strong>Note on savings:</strong> Token savings and cost reduction are most impactful when using a pay-per-token API key (OpenRouter, Anthropic API, etc.). If you are on a Claude Pro/Max subscription, vault redaction and caching still work, but the cost savings shown here may not reflect your actual subscription spend.
  </span></div>
</div>`;
}

function buildWeaveHtml(
  config: ReturnType<typeof getConfig>,
  weave: { repo: WeaveRepoStats; session: WeaveSessionStats } | undefined,
): string {
  if (!config.weave.enabled) {
    return `<div class="quota-panel"><span style="color:var(--vscode-descriptionForeground);font-size:12px">tpt-weave integration is off. Enable <code>tpt.weave.enabled</code> and run <code>tpt-weave adopt</code> in the workspace to route repository context through the local index.</span></div>`;
  }
  if (!weave) {
    return `<div class="quota-panel"><span style="color:var(--vscode-descriptionForeground);font-size:12px">No indexed workspace found. Run <code>tpt-weave adopt</code> in a workspace folder (requires the tpt-weave CLI).</span></div>`;
  }
  const { repo, session } = weave;
  const sessionSaved = Math.max(0, Math.round(session.rawBytes / 4) - session.skeletonTokens);
  return `<div class="quota-panel">
    <div class="quota-row"><span class="quota-label">Repository</span><span class="quota-val">${repo.repository} (${repo.files} files, ${repo.symbols} symbols)</span></div>
    <div class="quota-row"><span class="quota-label">Raw repository context</span><span class="quota-val">${repo.rawTokens.toLocaleString()} tokens</span></div>
    <div class="quota-row"><span class="quota-label">Delivered by index</span><span class="quota-val">${repo.selectedTokens.toLocaleString()} tokens (${repo.reductionPct.toFixed(1)}% reduction)</span></div>
    <div class="quota-row"><span class="quota-label">Index cache hit rate</span><span class="quota-val">${(repo.cacheHitRate * 100).toFixed(1)}%</span></div>
    <div class="quota-row"><span class="quota-label">Skeleton replacements this session</span><span class="quota-val">${session.replacements.toLocaleString()} (~${sessionSaved.toLocaleString()} tokens saved)</span></div>
  </div>`;
}

function buildQuotaHtml(quota: QuotaSnapshot | undefined, provider: string): string {
  if (!quota) {
    return `<div class="quota-panel"><span style="color:var(--vscode-descriptionForeground);font-size:12px">No quota data yet. Make a request or wait for the next poll (every ${180}s by default).</span></div>`;
  }

  const rows: string[] = [];

  if (quota.creditsRemaining !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Credits remaining</span><span class="quota-val">$${quota.creditsRemaining.toFixed(4)}</span></div>`);
  }
  if (quota.creditsTotal !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Credits total</span><span class="quota-val">$${quota.creditsTotal.toFixed(4)}</span></div>`);
  }
  if (quota.creditsUsed !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Credits used</span><span class="quota-val">$${quota.creditsUsed.toFixed(4)}</span></div>`);
  }
  if (quota.rateLimitTokensRemaining !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Tokens remaining (rate window)</span><span class="quota-val">${quota.rateLimitTokensRemaining.toLocaleString()}</span></div>`);
  }
  if (quota.rateLimitTokensReset !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Tokens reset at</span><span class="quota-val">${quota.rateLimitTokensReset}</span></div>`);
  }
  if (quota.rateLimitRequestsRemaining !== undefined) {
    rows.push(`<div class="quota-row"><span class="quota-label">Requests remaining (rate window)</span><span class="quota-val">${quota.rateLimitRequestsRemaining.toLocaleString()}</span></div>`);
  }

  if (rows.length === 0) {
    rows.push(`<div style="color:var(--vscode-descriptionForeground);font-size:12px">Quota data not available for ${provider}. Make a request to capture rate-limit headers.</div>`);
  }

  const lastUpdated = quota.lastUpdated > 0
    ? `Last updated: ${new Date(quota.lastUpdated).toLocaleTimeString()} · Provider: ${quota.provider}`
    : '';

  return `<div class="quota-panel">
    ${rows.join('')}
    ${lastUpdated ? `<div class="quota-ts">${lastUpdated}</div>` : ''}
  </div>`;
}

export function disposeDashboard(): void {
  panel?.dispose();
  panel = undefined;
}
