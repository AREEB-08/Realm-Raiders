#!/usr/bin/env node
/**
 * Asset import (§12.2): every GLB under assets/raw/<pack>/ must have a licence row in
 * assets/LICENSES.csv (CC0, MIT, OFL, Apache-2.0 or CC-BY + credit), then it is optimised with
 * gltf-transform (meshopt + KTX2, falling back to WebP) into apps/client/public/assets/characters/.
 *   node tools/assets/import.mjs [--dry-run]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = join(root, 'assets', 'raw');
const out = join(root, 'apps', 'client', 'public', 'assets', 'characters');
const ALLOWED = /^(CC0|CC0-1\.0|MIT|OFL|OFL-1\.1|Apache-2\.0|CC-BY(-[\d.]+)?)$/i;
const rows = readFileSync(join(root, 'assets', 'LICENSES.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(','));
const licensed = new Map(rows.map((r) => [r[0].split(String.fromCharCode(92)).join('/'), r[3]]));
const dry = process.argv.includes('--dry-run');

function* walk(d) {
  if (!existsSync(d)) return;
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.(glb|gltf)$/i.test(f)) yield p;
  }
}

let refused = 0;
let done = 0;
for (const file of walk(raw)) {
  const rel = relative(root, file).split(String.fromCharCode(92)).join('/');
  const pack = rel.split('/').slice(0, 3).join('/');
  const lic = licensed.get(rel) ?? licensed.get(pack);
  if (!lic || !ALLOWED.test(lic)) {
    console.error(`✗ refused ${rel}: no allowed licence row in assets/LICENSES.csv`);
    refused++;
    continue;
  }
  const slot = basename(dirname(file));
  const dest = join(out, slot, basename(file).replace(/\.gltf$/i, '.glb'));
  if (dry) {
    console.log(`would import ${rel} (${lic}) → ${relative(root, dest)}`);
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  const base = ['@gltf-transform/cli@4.5.1', 'optimize', file, dest, '--compress', 'meshopt', '--texture-size', '1024'];
  try {
    execFileSync('npx', ['-y', ...base, '--texture-compress', 'ktx2'], { stdio: 'inherit', shell: true });
  } catch {
    execFileSync('npx', ['-y', ...base, '--texture-compress', 'webp'], { stdio: 'inherit', shell: true });
  }
  done++;
}
console.log(`imported ${done}, refused ${refused}`);
process.exit(refused ? 1 : 0);
