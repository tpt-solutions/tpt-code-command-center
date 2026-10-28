import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { startProxyServer, stopProxyServer, getProxyUrl, getSessionToken, testProxyConnection } from './proxy/server';
import { pickAndApplyPreset } from './ui/presets';
import { runVault } from './modules/vault';
import { createStatusBar, updateStatusBar, showToggleMenu, disposeStatusBar } from './ui/statusBar';
import { showDashboard, refreshDashboard, disposeDashboard } from './ui/dashboard';
import * as os from 'os';
import { getStats, clearLedger, exportLedgerCsv, getMonthlyStats, getModuleSavings, getTuningSample, setStoragePath, setOnRecordHook, flushLedger } from './ledger/ledger';
import { startQuotaPolling, stopQuotaPolling } from './modules/quotaTracker';
import { clearCache } from './modules/tokenShield';
import { browseForge, refreshInstalledForge } from './modules/forge';
import { setWasmDir } from './modules/smartContext';
import { showModelPicker } from './ui/modelPicker';
import { log, getChannel, disposeChannel } from './utils/logger';
import { getLastInspectSnapshot } from './utils/inspectStore';
import { formatStageSavings, renderSavingsReport, tuningSuggestions } from './utils/savings';
import { POLICY_FILE, readPolicyState, describePolicyState, setTrustedPolicyHashes, isPolicyTrusted, markPolicyTrusted } from './modules/policy';
import { showPromptDiff } from './ui/promptDiff';
import { configureClineAuto } from './modules/clineConfig';
import { runSetupWizard } from './ui/setupWizard';
import { getConfig } from './utils/config';
import { initConnectionState } from './utils/connection';
import { API_KEY_SETTINGS, SettingsLike, clearKeys, loadKeys, migrateKeysFromSettings } from './utils/secrets';

// The settings-file view the migration needs: each scope's value, and removal from both scopes
function vscodeSettings(): SettingsLike {
  const cfg = vscode.workspace.getConfiguration('tpt');
  return {
    read(name) {
      const inspected = cfg.inspect<string>(name);
      return { workspace: inspected?.workspaceValue, global: inspected?.globalValue };
    },
    async remove(name) {
      const inspected = cfg.inspect<string>(name);
      if (inspected?.workspaceValue !== undefined) {
        await cfg.update(name, undefined, vscode.ConfigurationTarget.Workspace);
      }
      if (inspected?.globalValue !== undefined) {
        await cfg.update(name, undefined, vscode.ConfigurationTarget.Global);
      }
    },
  };
}

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
  // .vscode/settings.json holds the keys and session token; .tpt/ holds the ledger and cache,
  // which contain prompts. Each is ignored when the .gitignore has it in any common form.
  const lines = content.split('\n').map((line) => line.trim());
  const isIgnored = (...forms: string[]) => lines.some((t) => forms.includes(t));
  const missing: string[] = [];
  if (!isIgnored('.vscode/settings.json', '.vscode/', '.vscode')) missing.push('.vscode/settings.json');
  if (!isIgnored('.tpt/', '.tpt', '/.tpt/', '/.tpt')) missing.push('.tpt/');
  if (missing.length === 0) return;
  const stateKey = 'tpt.gitignorePromptDismissed';
  if (context.globalState.get<boolean>(stateKey)) return;
  vscode.window.showWarningMessage(
    'TPT writes API keys and a session token to .vscode/settings.json, and prompts to .tpt/. Add them to .gitignore to avoid accidental commits?',
    'Add to .gitignore', 'Not now'
  ).then((choice) => {
    if (choice === 'Add to .gitignore') {
      const entry = `\n# TPT Code Command Center — contains API keys, session token and prompts\n${missing.join('\n')}\n`;
      fs.appendFileSync(gitignorePath, entry, 'utf8');
      vscode.window.showInformationMessage(`Added ${missing.join(', ')} to .gitignore.`);
    } else {
      context.globalState.update(stateKey, true);
    }
  });
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('TPT Code Command Center activating...');

  // Persist ledger data even when no workspace folder is open
  setStoragePath(context.globalStorageUri.fsPath);
  initConnectionState(context.globalState);

  // Keys move from settings.json into SecretStorage on first run; the cache is loaded before
  // the proxy reads its config
  await loadKeys(context.secrets);
  const moved = await migrateKeysFromSettings(context.secrets, vscodeSettings());
  if (moved.length > 0) {
    log(`Moved ${moved.length} API key setting(s) from settings.json into secure storage`);
  }

  // Point Smart Context at the bundled WASM files shipped inside the extension
  const wasmDir = require('path').join(context.extensionPath, 'media', 'wasm');
  setWasmDir(wasmDir);

  // Status bar — show spinner immediately while the server starts
  const statusBar = createStatusBar();
  context.subscriptions.push(statusBar);

  // Guard against accidental API key commits
  checkGitignore(context);

  // A workspace policy applies only once the user trusts this exact file. A changed file has a new
  // hash, so it asks again.
  setTrustedPolicyHashes(context.globalState.get<string[]>('tpt.policyTrust', []));
  const policyState = readPolicyState();
  if (policyState.kind === 'broken') {
    vscode.window.showWarningMessage(
      `${POLICY_FILE} is not valid JSON, so it is ignored. Run "TPT: Show Workspace Policy" for details.`
    );
  }
  const policyFile = policyState.kind === 'loaded' ? policyState.loaded : undefined;
  if (policyFile && !isPolicyTrusted(policyFile)) {
    vscode.window.showWarningMessage(
      `This workspace has a TPT policy (${POLICY_FILE}). It can add Vault patterns, lower cost budgets and turn on dry run. Apply it?`,
      'Trust and apply', 'Not now'
    ).then((choice) => {
      if (choice === 'Trust and apply') {
        context.globalState.update('tpt.policyTrust', markPolicyTrusted(policyFile.hash));
        log(`Workspace policy trusted (${policyFile.hash.slice(0, 12)})`);
      }
    });
  }

  // First-run: offer setup wizard if no API key is configured
  const current = getConfig() as unknown as Record<string, string>;
  const hasAnyKey = API_KEY_SETTINGS.some((k) => !!current[k]);
  // The getting-started walkthrough replaces the old dismissible toast. It opens once; it stays in
  // the Getting Started list afterwards, so nothing is lost when it is closed.
  if (!hasAnyKey && !context.globalState.get<boolean>('tpt.wizardDismissed')) {
    context.globalState.update('tpt.wizardDismissed', true);
    vscode.commands.executeCommand(
      'workbench.action.openWalkthrough',
      `${context.extension.id}#tpt.gettingStarted`,
      false
    );
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

    // memory.json is the only record of what Memory Weaver summarised; this makes it readable
    vscode.commands.registerCommand('tpt.showMemory', async () => {
      const memPath = memoryFilePath();
      if (!memPath || !fs.existsSync(memPath)) {
        vscode.window.showInformationMessage('TPT: there are no Memory Weaver summaries yet.');
        return;
      }
      const doc = await vscode.workspace.openTextDocument(memPath);
      await vscode.window.showTextDocument(doc, { preview: true });
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

    vscode.commands.registerCommand('tpt.testVault', async () => {
      // Runs the same redaction the proxy applies, on the selection or on typed text
      const editor = vscode.window.activeTextEditor;
      const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : undefined;
      const text = selected ?? await vscode.window.showInputBox({
        prompt: 'Text to check against the Vault patterns',
        ignoreFocusOut: true,
      });
      if (!text) return;

      const result = runVault({ messages: [{ role: 'user', content: text }] }, getConfig().vault.customRegex);
      const redacted = (result.body as { messages: Array<{ content: string }> }).messages[0].content;
      const doc = await vscode.workspace.openTextDocument({ content: redacted, language: 'plaintext' });
      await vscode.window.showTextDocument(doc, { preview: true });
      vscode.window.showInformationMessage(`TPT: ${result.redacted} pattern match(es) redacted in the preview.`);
    }),

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

    vscode.commands.registerCommand('tpt.showSavings', () => {
      const snapshot = getLastInspectSnapshot();
      if (!snapshot?.stageTokens) {
        vscode.window.showInformationMessage('TPT: No request has been proxied yet.');
        return;
      }
      const channel = getChannel();
      channel.show(true);
      channel.appendLine(`\n─── TPT Token Savings (last request${snapshot.dryRun ? ', dry run: sent unchanged' : ''}) ───`);
      for (const line of formatStageSavings(snapshot.stageTokens)) channel.appendLine(line);
    }),

    vscode.commands.registerCommand('tpt.showPolicy', () => {
      const state = readPolicyState();
      const trusted = state.kind === 'loaded' && isPolicyTrusted(state.loaded);
      const channel = getChannel();
      channel.show(true);
      channel.appendLine('\n─── TPT Workspace Policy ────────────────────────────────────');
      for (const line of describePolicyState(state, trusted)) channel.appendLine(line);
      channel.appendLine('─────────────────────────────────────────────────────────────\n');
    }),
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

    vscode.commands.registerCommand('tpt.suggestSettings', async () => {
      const sample = await getTuningSample();
      const c = getConfig();
      const suggestions = tuningSuggestions(sample, {
        memoryEnabled: c.memoryWeaver.enabled,
        memoryThreshold: c.memoryWeaver.tokenThreshold,
        routerEnabled: c.router.enabled,
      });
      const channel = getChannel();
      channel.show(true);
      channel.appendLine(`\n─── TPT Settings Suggestions (from ${sample.originals.length} measured requests; nothing is changed) ───`);
      for (const line of suggestions) channel.appendLine(`• ${line}`);
    }),

    vscode.commands.registerCommand('tpt.exportSavingsReport', async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const { modules, measuredRequests } = await getModuleSavings(monthStart);
      const period = now.toISOString().slice(0, 7);
      const report = renderSavingsReport({ period, modules, measuredRequests });
      const downloadsDir = path.join(os.homedir(), 'Downloads');
      const outDir = fs.existsSync(downloadsDir) ? downloadsDir : (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.tmpdir());
      const outPath = path.join(outDir, `tpt-savings-${period}.md`);
      fs.writeFileSync(outPath, report, 'utf8');
      vscode.window.showInformationMessage(`TPT: Savings report exported to ${outPath}`, 'Open File').then((choice) => {
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
      await clearKeys(context.secrets);
      await Promise.all([
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
    // Forge auto-update is on by default and makes a network call when entries are installed;
    // it runs in the background so a slow or offline registry never delays the proxy
    if (getConfig().forge.autoUpdate) {
      refreshInstalledForge().catch((e) => log(`Forge: auto-update failed — ${e}`));
    }
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

  // The Output Channel is available from the status bar and the commands; it is not
  // opened on every activation (it would take focus from the editor each time)
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
