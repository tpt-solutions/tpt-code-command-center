import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { startProxyServer, stopProxyServer, getProxyUrl, getSessionToken, testProxyConnection } from './proxy/server';
import { pickAndApplyPreset } from './ui/presets';
import { createStatusBar, updateStatusBar, showToggleMenu, disposeStatusBar } from './ui/statusBar';
import { showDashboard, refreshDashboard, disposeDashboard } from './ui/dashboard';
import * as os from 'os';
import { getStats, clearLedger, exportLedgerCsv, getMonthlyStats, setStoragePath, setOnRecordHook, flushLedger } from './ledger/ledger';
import { startQuotaPolling, stopQuotaPolling } from './modules/quotaTracker';
import { clearCache } from './modules/tokenShield';
import { browseForge } from './modules/forge';
import { setWasmDir } from './modules/smartContext';
import { showModelPicker } from './ui/modelPicker';
import { log, getChannel, disposeChannel } from './utils/logger';
import { getLastInspectSnapshot } from './utils/inspectStore';
import { showPromptDiff } from './ui/promptDiff';
import { configureClineAuto } from './modules/clineConfig';
import { runSetupWizard } from './ui/setupWizard';
import { getConfig } from './utils/config';

function memoryFilePath(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  return path.join(folders[0].uri.fsPath, '.tpt', 'memory.json');
}

function checkGitignore(context: vscode.ExtensionContext): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;
  const root = folders[0].uri.fsPath;
  const gitignorePath = path.join(root, '.gitignore');
  if (!fs.existsSync(gitignorePath)) return;
  const content = fs.readFileSync(gitignorePath, 'utf8');
  // Check if .vscode/settings.json is already ignored (various common forms)
  const alreadyIgnored = content.split('\n').some((line) => {
    const t = line.trim();
    return t === '.vscode/settings.json' || t === '.vscode/' || t === '.vscode';
  });
  if (alreadyIgnored) return;
  const stateKey = 'tpt.gitignorePromptDismissed';
  if (context.globalState.get<boolean>(stateKey)) return;
  vscode.window.showWarningMessage(
    'TPT writes API keys and a session token to .vscode/settings.json. Add it to .gitignore to avoid accidental commits?',
    'Add to .gitignore', 'Not now'
  ).then((choice) => {
    if (choice === 'Add to .gitignore') {
      const entry = '\n# TPT Code Command Center — contains API keys and session token\n.vscode/settings.json\n';
      fs.appendFileSync(gitignorePath, entry, 'utf8');
      vscode.window.showInformationMessage('Added .vscode/settings.json to .gitignore.');
    } else {
      context.globalState.update(stateKey, true);
    }
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('TPT Code Command Center activating...');

  // Persist ledger data even when no workspace folder is open
  setStoragePath(context.globalStorageUri.fsPath);

  // Point Smart Context at the bundled WASM files shipped inside the extension
  const wasmDir = require('path').join(context.extensionPath, 'media', 'wasm');
  setWasmDir(wasmDir);

  // Status bar — show spinner immediately while the server starts
  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar);

  // Guard against accidental API key commits
  checkGitignore(context);

  // First-run: offer setup wizard if no API key is configured
  const cfg = vscode.workspace.getConfiguration('tpt');
  const hasAnyKey = ['openrouterApiKey', 'anthropicApiKey', 'openaiApiKey', 'deepseekApiKey', 'grokApiKey', 'qwenApiKey', 'kimiApiKey', 'glmApiKey', 'mimoApiKey', 'mistralApiKey']
    .some((k) => !!cfg.get<string>(k, ''));
  if (!hasAnyKey && !context.globalState.get<boolean>('tpt.wizardDismissed')) {
    vscode.window.showInformationMessage(
      'Welcome to TPT Code Command Center! Set up your API key to get started.',
      'Run Setup Wizard', 'Later'
    ).then((choice) => {
      if (choice === 'Run Setup Wizard') {
        runSetupWizard(context);
      } else {
        context.globalState.update('tpt.wizardDismissed', true);
      }
    });
  }

  // Keep status bar updated on config changes; restart quota polling when provider/key changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('tpt')) {
        updateStatusBar();
        refreshDashboard();
        stopQuotaPolling();
        startQuotaPolling(getConfig());
      }
    })
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('tpt.toggleSuite', () => showToggleMenu()),

    vscode.commands.registerCommand('tpt.showDashboard', () => showDashboard(context)),

    vscode.commands.registerCommand('tpt.showStats', async () => {
      const stats = await getStats();
      const msg = [
        `Requests: ${stats.totalRequests}`,
        `Tokens in: ${stats.totalTokensIn.toLocaleString()}`,
        `Tokens out: ${stats.totalTokensOut.toLocaleString()}`,
        `Cost: $${stats.totalCostUsd.toFixed(4)}`,
        `Cache hits: ${stats.cacheHits}`,
        `Est. savings: $${stats.estimatedSavingsUsd.toFixed(4)}`,
      ].join('  |  ');
      vscode.window.showInformationMessage(`TPT Stats — ${msg}`);
    }),

    vscode.commands.registerCommand('tpt.clearCache', async () => {
      await clearCache();
      vscode.window.showInformationMessage('TPT: Token Shield cache cleared.');
    }),

    vscode.commands.registerCommand('tpt.pruneMemory', async () => {
      const memPath = memoryFilePath();
      if (!memPath || !fs.existsSync(memPath)) {
        vscode.window.showInformationMessage('TPT: there is no Memory Weaver history to clear.');
        return;
      }
      const confirm = await vscode.window.showWarningMessage(
        'Clear the Memory Weaver summary history for this workspace?', { modal: true }, 'Clear'
      );
      if (confirm !== 'Clear') return;
      fs.unlinkSync(memPath);
      vscode.window.showInformationMessage('TPT: Memory Weaver history cleared.');
    }),

    vscode.commands.registerCommand('tpt.clearLedger', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Delete all recorded requests from the TPT ledger? This cannot be undone.', { modal: true }, 'Delete'
      );
      if (confirm !== 'Delete') return;
      await clearLedger();
      refreshDashboard();
      updateStatusBar();
      vscode.window.showInformationMessage('TPT: ledger cleared.');
    }),

    vscode.commands.registerCommand('tpt.applyPreset', () => pickAndApplyPreset()),

    vscode.commands.registerCommand('tpt.testConnection', async () => {
      const result = await testProxyConnection();
      if (result.ok) {
        vscode.window.showInformationMessage(`TPT: ${result.message}`);
      } else {
        vscode.window.showWarningMessage(`TPT: ${result.message}`);
      }
    }),

    vscode.commands.registerCommand('tpt.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', 'tpt')
    ),

    vscode.commands.registerCommand('tpt.copyClaudeCodeSnippet', async () => {
      const url = getProxyUrl();
      const token = getSessionToken();
      if (!url || !token) {
        vscode.window.showWarningMessage('TPT proxy is not running yet.');
        return;
      }
      const snippet =
        `# PowerShell\n` +
        `$env:ANTHROPIC_BASE_URL="${url}"\n` +
        `$env:ANTHROPIC_CUSTOM_HEADERS="X-TPT-Token: ${token}"\n\n` +
        `# bash / zsh\n` +
        `export ANTHROPIC_BASE_URL="${url}"\n` +
        `export ANTHROPIC_CUSTOM_HEADERS="X-TPT-Token: ${token}"\n`;
      await vscode.env.clipboard.writeText(snippet);
      vscode.window.showInformationMessage(
        'TPT: Claude Code environment variables copied. Paste them into a terminal, then run claude.'
      );
    }),

    vscode.commands.registerCommand('tpt.browseForge', () => browseForge()),

    vscode.commands.registerCommand('tpt.configureModels', () => showModelPicker()),

    vscode.commands.registerCommand('tpt.inspectLast', () => {
      const snapshot = getLastInspectSnapshot();
      if (!snapshot) {
        vscode.window.showInformationMessage('TPT: No request has been proxied yet.');
        return;
      }
      const channel = getChannel();
      channel.show(true);
      const date = new Date(snapshot.timestamp).toLocaleString();
      channel.appendLine('\n─── TPT Inspect ─────────────────────────────────────────────');
      channel.appendLine(`Time: ${date}  Format: ${snapshot.format}  Cache hit: ${snapshot.cacheHit}`);
      channel.appendLine(`Module actions: ${snapshot.moduleActions.join(', ') || '(none)'}`);
      if (snapshot.overrideUpstream) {
        const u = snapshot.overrideUpstream;
        channel.appendLine(`Router override: ${u.model ?? '(same)'} @ ${u.baseUrl}`);
      }
      channel.appendLine('\n── Processed body sent to upstream ──');
      channel.appendLine(JSON.stringify(snapshot.processedBody, null, 2));
      channel.appendLine('─────────────────────────────────────────────────────────────\n');
    }),

    vscode.commands.registerCommand('tpt.showPromptDiff', () => showPromptDiff(context)),

    vscode.commands.registerCommand('tpt.exportLedger', async () => {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '', 'tpt-ledger.csv')),
        filters: { 'CSV files': ['csv'], 'All files': ['*'] },
        saveLabel: 'Export Ledger',
      });
      if (!uri) return;
      const csv = await exportLedgerCsv();
      fs.writeFileSync(uri.fsPath, csv, 'utf8');
      vscode.window.showInformationMessage(`TPT: Ledger exported to ${uri.fsPath}`);
    }),

    vscode.commands.registerCommand('tpt.configureCline', () => {
      const url = getProxyUrl();
      const token = getSessionToken();
      if (!url || !token) {
        vscode.window.showWarningMessage('TPT proxy is not running yet.');
        return;
      }
      configureClineAuto(url, token);
    }),

    vscode.commands.registerCommand('tpt.copyProxyUrl', async () => {
      const url = getProxyUrl();
      if (url) {
        await vscode.env.clipboard.writeText(url);
        vscode.window.showInformationMessage(
          `TPT proxy URL copied: ${url}\n\nTo use with Claude Code, set ANTHROPIC_BASE_URL=${url} in your terminal.\nTo use with Cline, point the custom base URL to ${url}.`
        );
      } else {
        vscode.window.showWarningMessage('TPT proxy is not running yet.');
      }
    }),

    vscode.commands.registerCommand('tpt.copySessionToken', async () => {
      const token = getSessionToken();
      if (!token) {
        vscode.window.showWarningMessage('TPT proxy is not running yet.');
        return;
      }
      await vscode.env.clipboard.writeText(token);
      vscode.window.showInformationMessage(
        'TPT session token copied. Send it as the X-TPT-Token header. ' +
        'Terminals opened in this workspace already set ANTHROPIC_CUSTOM_HEADERS for Claude Code.'
      );
    }),

    vscode.commands.registerCommand('tpt.runSetupWizard', () => runSetupWizard(context)),

    vscode.commands.registerCommand('tpt.exportMonthlySummary', async () => {
      const monthlyStats = await getMonthlyStats(12);
      const header = 'Month,Requests,Tokens In,Tokens Out,Cost USD,Cache Hits,Saved USD,Tokens Saved\n';
      const lines = monthlyStats.map((m) =>
        [m.month, m.requests,
         m.tokensIn, m.tokensOut, m.costUsd.toFixed(8), m.cacheHits, m.savedUsd.toFixed(8), m.tokensSaved].join(',')
      );
      const csv = header + lines.join('\n');
      const monthTag = new Date().toISOString().slice(0, 7);
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      const outDir = fs.existsSync(downloadsDir) ? downloadsDir : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir());
      const outPath = path.join(outDir, `tpt-summary-${monthTag}.csv`);
      fs.writeFileSync(outPath, csv, 'utf8');
      vscode.window.showInformationMessage(`TPT: Monthly summary exported to ${outPath}`, 'Open File').then((choice) => {
        if (choice === 'Open File') vscode.env.openExternal(vscode.Uri.file(outPath));
      });
    }),

    vscode.commands.registerCommand('tpt.resetSetup', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Clear all TPT API keys and reset provider to OpenRouter?',
        { modal: true },
        'Yes, reset'
      );
      if (confirm !== 'Yes, reset') return;
      const c = vscode.workspace.getConfiguration('tpt');
      const target = vscode.ConfigurationTarget.Workspace;
      await Promise.all([
        c.update('openrouterApiKey', '', target),
        c.update('anthropicApiKey', '', target),
        c.update('openaiApiKey', '', target),
        c.update('deepseekApiKey', '', target),
        c.update('qwenApiKey', '', target),
        c.update('kimiApiKey', '', target),
        c.update('grokApiKey', '', target),
        c.update('glmApiKey', '', target),
        c.update('mimoApiKey', '', target),
        c.update('mistralApiKey', '', target),
        c.update('customApiKey', '', target),
        c.update('customBaseUrl', '', target),
        c.update('upstreamProvider', 'openrouter', target),
      ]);
      context.globalState.update('tpt.wizardDismissed', false);
      vscode.window.showInformationMessage('TPT: Configuration reset. Run the Setup Wizard to reconfigure.');
    }),
  );

  // Show proxy URL in output channel on startup
  const proxyUrl = getProxyUrl();
  // Start the proxy after the commands are registered: if it fails, the setup wizard, copy
  // commands and cache tools still work
  try {
    await startProxyServer(context);
    updateStatusBar();
    startQuotaPolling(getConfig());
    setOnRecordHook(() => {
      refreshDashboard();
      updateStatusBar();
    });
  } catch (err) {
    updateStatusBar();
    const msg = err instanceof Error ? err.message : String(err);
    log(`TPT proxy failed to start: ${msg}`);
    vscode.window.showErrorMessage(
      `TPT proxy failed to start: ${msg}`,
      'Show Output'
    ).then((choice) => {
      if (choice === 'Show Output') getChannel().show(true);
    });
  }

  // The token is a credential: it is copied via "TPT: Copy Session Token", never printed here
  if (proxyUrl) {
    log(`Proxy URL: ${proxyUrl}`);
    log('Session token: run "TPT: Copy Session Token" to copy it (sent as the X-TPT-Token header).');
    log(`For Claude Code: ANTHROPIC_BASE_URL=${proxyUrl} and ANTHROPIC_CUSTOM_HEADERS are injected into new terminals.`);
    log(`For Cline: set custom base URL to ${proxyUrl} and add the X-TPT-Token header (or run "TPT: Auto-Configure Cline").`);
  }

  // Show channel automatically on first activation
  const channel = getChannel();
  channel.show(true);

  log('TPT Code Command Center activated.');
}

export async function deactivate(): Promise<void> {
  // Write any batched ledger rows before the window goes away
  flushLedger();
  await stopProxyServer();
  stopQuotaPolling();
  disposeDashboard();
  disposeStatusBar();
  disposeChannel();
}
