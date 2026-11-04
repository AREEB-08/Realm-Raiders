#!/usr/bin/env node
/** Pre-commit (§18): refuse staged private keys / keystores, then run the originality gate. */
import { execFileSync, execSync } from 'node:child_process';

const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).split('\n').filter(Boolean);
const bad = staged.filter((f) => /(^|\/)\.env$|\.keystore$|keystore\.properties$/.test(f));
const diff = execSync('git diff --cached -U0', { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const keys = diff.split('\n').filter((l) => l.startsWith('+') && /(PRIVATE_KEY|SECRET)\s*=\s*\S{16,}/.test(l));
if (bad.length || keys.length) {
  console.error('✗ refusing to commit secrets:');
  for (const f of bad) console.error(`   file ${f}`);
  for (const l of keys) console.error(`   ${l.slice(0, 60)}…`);
  process.exit(1);
}
execFileSync(process.execPath, ['scripts/check-originality.mjs'], { stdio: 'inherit' });
