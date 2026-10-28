// A stand-in for one VS Code window, run as its own process by ledgerConcurrency.test.ts.
// Usage: node ledgerWriter.js <storage dir> <label> <rows>
import './mock-vscode'; // must be first — stubs vscode before any module loads it
import { setStoragePath, recordRequest, flushLedger } from '../../ledger/ledger';

const [dir, label, count] = process.argv.slice(2);

async function main(): Promise<void> {
  setStoragePath(dir);
  for (let i = 0; i < Number(count); i++) {
    await recordRequest({ model: `${label}-${i}`, tokensIn: 1, tokensOut: 1, costUsd: 0, moduleActions: [], cacheHit: false });
  }
  // One flush at the end, so the rows are written in a single read-modify-write, racing the others
  flushLedger();
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
