#!/usr/bin/env node
/**
 * Verify the deployed contracts on Sourcify (MonadVision reads it) using the solc metadata from
 * the same compile that produced the deployed bytecode. No API key needed.
 *   node scripts/verify.mjs [--chain 10143] [--server https://sourcify-api-monad.blockvision.org]
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const ozRoot = dirname(require.resolve('@openzeppelin/contracts/package.json'));
const arg = (n, d) => (process.argv.includes(`--${n}`) ? process.argv[process.argv.indexOf(`--${n}`) + 1] : d);
const chain = arg('chain', '10143');
const server = arg('server', 'https://sourcify-api-monad.blockvision.org').replace(/\/$/, '');
const dep = JSON.parse(readFileSync(join(root, 'deployments', `${chain}.json`), 'utf8'));

const source = (path) =>
  path.startsWith('@openzeppelin/contracts/') ? readFileSync(join(ozRoot, path.slice('@openzeppelin/contracts/'.length)), 'utf8') : readFileSync(join(root, path), 'utf8');

let failed = 0;
for (const name of ['RealmLedger', 'ClanSiege', 'RealmBadges', 'RealmDuels']) {
  const address = dep[name];
  if (!address) continue;
  const art = JSON.parse(readFileSync(join(root, 'artifacts', `${name}.json`), 'utf8'));
  const meta = JSON.parse(art.metadata);
  const files = { 'metadata.json': art.metadata };
  for (const path of Object.keys(meta.sources)) files[path] = source(path);
  const res = await fetch(`${server}/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ address, chain, files }),
  });
  const body = await res.text();
  const ok = res.ok && /perfect|partial|match/i.test(body);
  if (!ok) failed++;
  console.log(`${ok ? '✓' : '✗'} ${name} ${address}: ${body.slice(0, 200)}`);
}
process.exit(failed ? 1 : 0);
