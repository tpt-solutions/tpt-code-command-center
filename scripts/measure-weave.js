// Phase 12 measurement (todo.md: tpt-code-command-center — measure baseline /
// post-integration). Compares Smart Context's built-in outlining (tree-sitter
// when WASM is present, regex otherwise) against routing Rust files through
// the tpt-weave index, over real files from a tpt-weave-indexed repository.
//
// Usage: node scripts/measure-weave.js <indexed-repo-dir> [tpt-weave-cli-path]
// Requires `npm run compile` first (uses the out/ build) and `tpt-weave
// adopt <repo>` for the weave leg.

process.env.TPT_MEASURE = '1';

// Stub vscode before loading compiled modules that require it (same trick as
// src/test/helpers/mock-vscode.ts).
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (...args) {
  if (args[0] === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (_k, d) => d }), workspaceFolders: undefined },
      window: { createOutputChannel: () => ({ appendLine: (s) => console.log('  [weave log]', s), show: () => undefined }) },
      commands: { executeCommand: () => Promise.resolve() },
      ConfigurationTarget: { Workspace: 2, Global: 1 },
    };
  }
  return originalLoad.apply(this, args);
};

const fs = require('fs');
const path = require('path');
const { setWasmDir } = require('../out/modules/smartContext');
const { runSmartContext } = require('../out/modules/smartContext');
const { createWeaveQuery, getWeaveSessionStats } = require('../out/modules/weave');

const repo = path.resolve(process.argv[2] || process.cwd());
const cliPath = process.argv[3] || 'tpt-weave';

setWasmDir(path.join(__dirname, '..', 'media', 'wasm'));

// Collect the largest .rs files (what Smart Context actually processes).
// The 4 KB outlining threshold is the comparison gate; the production
// default (512 KB) stays configurable via tpt.smartContext.maxFileSize.
const MAX_FILE_SIZE = 4 * 1024;
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'target' || entry.name === '.git' || entry.name === '.tpt-weave' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.rs')) files.push(full);
  }
})(repo);

files.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size);
const sample = files.slice(0, 12);
if (sample.length === 0) {
  console.error(`no .rs files under ${repo}`);
  process.exit(1);
}

function tokens(text) {
  return Math.ceil(Buffer.byteLength(text) / 4);
}

function buildMessages(paths) {
  return paths.map((p) => ({
    role: 'user',
    content: [
      {
        type: 'tool_result',
        content: fs.readFileSync(p, 'utf8'),
        path: path.relative(repo, p),
      },
    ],
  }));
}

function summarise(label, result, rawBytes) {
  let bytes = 0;
  for (const msg of result.messages) {
    for (const block of msg.content) {
      if (typeof block.content === 'string') bytes += Buffer.byteLength(block.content);
    }
  }
  const row = {
    leg: label,
    files_replaced: result.replaced,
    via_weave: result.weaveReplaced,
    raw_tokens: Math.ceil(rawBytes / 4),
    delivered_tokens: Math.ceil(bytes / 4),
    reduction_pct: (100 * (1 - bytes / rawBytes)).toFixed(1),
  };
  console.log(JSON.stringify(row));
  return row;
}

(async () => {
  const rawBytes = sample.reduce((sum, p) => sum + fs.statSync(p).size, 0);
  console.log(`repository: ${repo}`);
  console.log(`sample: ${sample.length} largest .rs files, ${(rawBytes / 1024).toFixed(0)} KB total\n`);

  const messages = buildMessages(sample);

  // Baseline leg — built-in tree-sitter/regex outlining only.
  const baseline = await runSmartContext(messages.map((m) => structuredClone(m)), MAX_FILE_SIZE);
  const baseRow = summarise('baseline (smart context only)', baseline, rawBytes);

  // Post-integration leg — weave-indexed skeletons with fallback.
  const weave = createWeaveQuery({ cliPath, roots: [repo], level: 2 });
  if (!weave) {
    console.error('\nthis repository has no .tpt-weave index; run `tpt-weave adopt` first');
    process.exit(1);
  }
  const started = Date.now();
  const integrated = await runSmartContext(
    messages.map((m) => structuredClone(m)),
    MAX_FILE_SIZE,
    weave
  );
  const elapsedMs = Date.now() - started;
  const weaveRow = summarise('post-integration (weave index)', integrated, rawBytes);
  const session = getWeaveSessionStats();

  console.log('\nsummary');
  console.log(`  baseline delivered : ${baseRow.delivered_tokens} tokens (${baseRow.reduction_pct}% vs raw)`);
  console.log(`  weave delivered    : ${weaveRow.delivered_tokens} tokens (${weaveRow.reduction_pct}% vs raw)`);
  console.log(`  weave skeleton hits: ${session.replacements} (fallbacks: ${weaveRow.files_replaced - session.replacements})`);
  console.log(`  weave leg wall time: ${elapsedMs} ms incl. CLI spawns`);
  const skeletonText = integrated.messages[0].content[0].content;
  const baselineText = baseline.messages[0].content[0].content;
  console.log('\nfidelity probe (first file)');
  console.log(`  baseline outline: ${baselineText.split('\n').length} lines, signature truncation at 120 chars`);
  console.log(`  weave skeleton  : ${skeletonText.split('\n').length} lines, full signatures from the indexed parse`);
})();
