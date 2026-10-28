import * as vscode from 'vscode';
import { log } from '../utils/logger';

// Each preset is a bundle of `tpt.*` settings, keyed without the prefix.
// Keys must exist in package.json contributes.configuration (tested in presets.test.ts).
export interface Preset {
  id: string;
  label: string;
  description: string;
  settings: Record<string, unknown>;
}

const CLAUDE_SHORT_RULE = { match: { maxTokens: 2000 }, model: 'claude-haiku-5-5', provider: 'anthropic' };
const CLAUDE_CODE_RULE = {
  match: { extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'cs'] },
  model: 'claude-sonnet-5-5',
  provider: 'anthropic',
};

export const PRESETS: Preset[] = [
  {
    id: 'frugal',
    label: 'Frugal',
    description: 'Cut spend: cache repeated prompts, summarise long chats, cache-mark stable prefixes, route small requests to cheaper models',
    settings: {
      'tokenShield.enabled': true,
      'memoryWeaver.enabled': true,
      'smartContext.enabled': true,
      'promptCache.enabled': true,
      'router.enabled': true,
    },
  },
  {
    id: 'privacy',
    label: 'Privacy-first',
    description: 'Redact secrets before they leave the machine; no background network calls and no weave or semantic index',
    settings: {
      'vault.enabled': true,
      'forge.autoUpdate': false,
      'weave.enabled': false,
      'tokenShield.semanticCache.enabled': false,
      'router.enabled': false,
    },
  },
  {
    id: 'local',
    label: 'Local only (Ollama)',
    description: 'Nothing leaves the machine: requests go to a local model and summaries use Ollama only',
    settings: {
      upstreamProvider: 'local',
      'router.enabled': false,
      'forge.autoUpdate': false,
      'memoryWeaver.fallbackOrder': ['ollama', 'extractive'],
    },
  },
  {
    id: 'anthropic',
    label: 'Anthropic tiering (Claude only)',
    description: 'Claude Code and Claude-only setups: Haiku for short requests, Sonnet for code, Haiku for summaries',
    settings: {
      upstreamProvider: 'anthropic',
      'router.enabled': true,
      'router.rules': [CLAUDE_SHORT_RULE, CLAUDE_CODE_RULE],
      'memoryWeaver.anthropicSummaryModel': 'claude-haiku-5-5',
    },
  },
];

// The presets the setup wizard may offer once a provider is chosen: those that leave the provider
// alone, and those that set it to that same provider. Any other would replace the user's choice.
export function presetsForProvider(provider: string): Preset[] {
  return PRESETS.filter((p) => !('upstreamProvider' in p.settings) || p.settings.upstreamProvider === provider);
}

// Writes the preset into workspace settings when a folder is open, otherwise into user settings
// (a window with no folder cannot hold workspace settings).
export async function applyPreset(preset: Preset): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('tpt');
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  for (const [key, value] of Object.entries(preset.settings)) {
    await cfg.update(key, value, target);
  }
  log(`Applied preset "${preset.label}" (${Object.keys(preset.settings).length} settings)`);
}

export async function pickAndApplyPreset(): Promise<void> {
  const picked = await vscode.window.showQuickPick(
    PRESETS.map((p) => ({ label: p.label, description: p.description, preset: p })),
    { placeHolder: 'Choose a settings preset. It overwrites the settings it lists.' }
  );
  if (!picked) return;
  await applyPreset(picked.preset);
  vscode.window.showInformationMessage(`TPT: applied the "${picked.preset.label}" preset.`);
}
