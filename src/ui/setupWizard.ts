import * as vscode from 'vscode';
import { testProxyConnection } from '../proxy/server';
import { getChannel } from '../utils/logger';
import { ApiKeySetting, storeKey } from '../utils/secrets';

interface ProviderOption {
  label: string;
  description: string;
  provider: string;
  keyLabel: string;
  keyPlaceholder: string;
  keyUrl: string;
}

const PROVIDERS: ProviderOption[] = [
  {
    label: '$(globe) OpenRouter',
    description: 'Access 200+ models through one API key (recommended)',
    provider: 'openrouter',
    keyLabel: 'OpenRouter API key',
    keyPlaceholder: 'sk-or-...',
    keyUrl: 'https://openrouter.ai/keys',
  },
  {
    label: '$(anthropic) Anthropic',
    description: 'Direct access to Claude models',
    provider: 'anthropic',
    keyLabel: 'Anthropic API key',
    keyPlaceholder: 'sk-ant-...',
    keyUrl: 'https://console.anthropic.com/keys',
  },
  {
    label: '$(openai) OpenAI',
    description: 'Direct access to GPT models',
    provider: 'openai',
    keyLabel: 'OpenAI API key',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    label: '$(zap) DeepSeek',
    description: 'Direct access to DeepSeek models',
    provider: 'deepseek',
    keyLabel: 'DeepSeek API key',
    keyPlaceholder: 'sk-...',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    label: '$(zap) Qwen',
    description: 'Alibaba Cloud DashScope — Qwen models',
    provider: 'qwen',
    keyLabel: 'Qwen (DashScope) API key',
    keyPlaceholder: '',
    keyUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    label: '$(zap) Kimi',
    description: 'Moonshot AI — Kimi models',
    provider: 'kimi',
    keyLabel: 'Kimi (Moonshot) API key',
    keyPlaceholder: '',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    label: '$(zap) Grok',
    description: 'xAI — Grok models',
    provider: 'grok',
    keyLabel: 'Grok (xAI) API key',
    keyPlaceholder: '',
    keyUrl: 'https://console.x.ai',
  },
  {
    label: '$(zap) GLM',
    description: 'Zhipu AI / Z.ai — GLM models',
    provider: 'glm',
    keyLabel: 'GLM (Z.ai) API key',
    keyPlaceholder: '',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
  },
  {
    label: '$(zap) MiMo',
    description: 'Xiaomi — MiMo models',
    provider: 'mimo',
    keyLabel: 'MiMo (Xiaomi) API key',
    keyPlaceholder: '',
    keyUrl: 'https://platform.xiaomimimo.com',
  },
  {
    label: '$(zap) Mistral',
    description: 'Direct access to Mistral models',
    provider: 'mistral',
    keyLabel: 'Mistral API key',
    keyPlaceholder: '',
    keyUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    label: '$(zap) Groq',
    description: 'Groq — fast OpenAI-compatible inference',
    provider: 'groq',
    keyLabel: 'Groq API key',
    keyPlaceholder: '',
    keyUrl: 'https://console.groq.com/keys',
  },
  {
    label: '$(zap) Gemini',
    description: 'Google Gemini through its OpenAI-compatible endpoint',
    provider: 'gemini',
    keyLabel: 'Gemini API key',
    keyPlaceholder: '',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    label: '$(server) Local / Ollama',
    description: 'Local model running at localhost:11434 — no API key needed',
    provider: 'local',
    keyLabel: '',
    keyPlaceholder: '',
    keyUrl: '',
  },
  {
    label: '$(link) Custom endpoint',
    description: 'Any OpenAI-compatible API at a custom URL',
    provider: 'custom',
    keyLabel: 'API key (leave blank if not required)',
    keyPlaceholder: '',
    keyUrl: '',
  },
];

const PROVIDER_KEY_SETTING: Record<string, string> = {
  openrouter: 'openrouterApiKey',
  anthropic: 'anthropicApiKey',
  openai: 'openaiApiKey',
  deepseek: 'deepseekApiKey',
  qwen: 'qwenApiKey',
  kimi: 'kimiApiKey',
  grok: 'grokApiKey',
  glm: 'glmApiKey',
  mimo: 'mimoApiKey',
  mistral: 'mistralApiKey',
  groq: 'groqApiKey',
  gemini: 'geminiApiKey',
  custom: 'customApiKey',
};

const EXAMPLES_URL = 'https://github.com/tpt-solutions/tpt-code-command-center/blob/master/examples';

interface ToolOption extends vscode.QuickPickItem {
  run: () => Thenable<unknown>;
}

// Step 3, after a good connection check: point the tool the user works in at the proxy. Claude
// Code and Cline have commands that do it; the other tools have a guide in examples/.
async function offerToolSetup(): Promise<void> {
  const guide = (file: string) => () => vscode.env.openExternal(vscode.Uri.parse(`${EXAMPLES_URL}/${file}`));
  const options: ToolOption[] = [
    { label: 'Claude Code', description: 'Copy the environment snippet', run: () => vscode.commands.executeCommand('tpt.copyClaudeCodeSnippet') },
    { label: 'Cline', description: 'Write Cline\'s provider settings', run: () => vscode.commands.executeCommand('tpt.configureCline') },
    { label: 'Roo Code', description: 'Open the setup guide', run: guide('roo-code.md') },
    { label: 'Continue', description: 'Open the setup guide', run: guide('continue.md') },
    { label: 'Another tool', description: 'Open the examples folder', run: () => vscode.env.openExternal(vscode.Uri.parse(EXAMPLES_URL)) },
  ];
  const pick = await vscode.window.showQuickPick(options, {
    placeHolder: 'Step 3 — Which tool will use TPT? (you can skip this)',
    ignoreFocusOut: true,
  });
  if (pick) await pick.run();
}

export async function runSetupWizard(context: vscode.ExtensionContext): Promise<void> {
  // Step 1: pick provider
  const providerPick = await vscode.window.showQuickPick(
    PROVIDERS.map((p) => ({ label: p.label, description: p.description, _opt: p })),
    { placeHolder: 'Step 1 of 2 — Select your LLM provider', ignoreFocusOut: true }
  );
  if (!providerPick) return;

  const opt = providerPick._opt as ProviderOption;
  const cfg = vscode.workspace.getConfiguration('tpt');
  const target = vscode.ConfigurationTarget.Workspace;

  // Step 2: enter API key (skip for local)
  if (opt.provider !== 'local') {
    const hint = opt.keyUrl
      ? `Get your key at ${opt.keyUrl}`
      : undefined;
    const apiKey = await vscode.window.showInputBox({
      prompt: `Step 2 of 2 — ${opt.keyLabel}`,
      placeHolder: opt.keyPlaceholder,
      ignoreFocusOut: true,
      password: true,
      title: 'TPT Setup Wizard',
      valueSelection: undefined,
      ...(hint ? { prompt: `Step 2 of 2 — ${opt.keyLabel} (${hint})` } : {}),
    });
    if (apiKey === undefined) return; // user cancelled

    if (opt.provider === 'custom') {
      const baseUrl = await vscode.window.showInputBox({
        prompt: 'Custom API base URL',
        placeHolder: 'https://my-llm.example.com/v1',
        ignoreFocusOut: true,
        title: 'TPT Setup Wizard',
      });
      if (baseUrl === undefined) return;
      await cfg.update('customBaseUrl', baseUrl, target);
    }

    // Keys go to SecretStorage, never to settings.json
    const keySetting = PROVIDER_KEY_SETTING[opt.provider] as ApiKeySetting | undefined;
    if (keySetting && apiKey) {
      await storeKey(context.secrets, keySetting, apiKey);
    }
  }

  await cfg.update('upstreamProvider', opt.provider, target);
  // Mark wizard as completed so we don't prompt again on startup
  await context.globalState.update('tpt.wizardDismissed', true);

  // The proxy reads its config per request, so the new provider is live now. Check it
  // reaches the provider, so a wrong key shows up here and not on the first real request.
  const check = await testProxyConnection();
  if (check.ok) {
    vscode.window.showInformationMessage(
      `TPT configured to use ${opt.provider}. ${check.message} Open the dashboard to monitor usage.`,
      'Open Dashboard'
    ).then((choice) => {
      if (choice === 'Open Dashboard') {
        vscode.commands.executeCommand('tpt.showDashboard');
      }
    });
    await offerToolSetup();
    return;
  }

  vscode.window.showWarningMessage(
    `TPT is set to ${opt.provider}, but the check failed. ${check.message}`,
    'Open Settings', 'Open Output'
  ).then((choice) => {
    if (choice === 'Open Settings') vscode.commands.executeCommand('tpt.openSettings');
    if (choice === 'Open Output') getChannel().show(true);
  });
}
