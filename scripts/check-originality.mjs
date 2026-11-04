#!/usr/bin/env node
/**
 * §3 originality gate — `pnpm check:originality`.
 * Fails (exit 1) on third-party game names / look-alike terms, imports of web-coc's excluded
 * data (`reference/`), or native-client asset paths, anywhere in our sources.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['apps', 'packages', 'tools', 'scripts', 'contracts/src', 'contracts/test', 'contracts/script'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.gradle', 'artifacts', 'out', 'cache', 'test-results', 'playwright-report', 'lib', '.vite']);
const EXT = /\.(ts|tsx|js|mjs|cjs|json|css|html|md|sol|xml|gradle|svg)$/i;
const SELF = 'scripts/check-originality.mjs';

const BANNED = [
  [/clash\s*of\s*clans|clashofclans/i, 'Clash of Clans'],
  [/supercell/i, 'Supercell'],
  [/game\s*of\s*thrones/i, 'Game of Thrones'],
  [/\btolkien\b|\bhobbit/i, 'Tolkien/Hobbit'],
  [/barbarian\s*king|archer\s*queen|grand\s*warden|royal\s*champion/i, 'reference hero names'],
  [/\belixir\b/i, '"Elixir"'],
  [/town\s*hall/i, '"Town Hall"'],
  [/builder'?s?\s*hut/i, '"Builder Hut"'],
  // Spec §2: no Supercell building/troop/currency names.
  [/\bbarbarians?\b/i, '"Barbarian"'],
  [/clan\s*castle/i, '"Clan Castle"'],
  [/gold\s*pass/i, '"Gold Pass"'],
  [/hog\s*rider|\bp\.?e\.?k\.?k\.?a\b/i, 'reference troop names'],
  // Gems are earned only (spec §2 / F7): no purchase screen, no real-money prices.
  [/buy\s+gems|gems?\s+(shop|store|packs?)\b|(₹|\bUSD\b|\bINR\b)\s*\d/i, 'Gem purchase / real-money price'],
  [/crown\s*(&|and|-)\s*clan/i, 'web-coc product name'],
  [/from\s+['"][^'"]*\breference\//, 'import from web-coc reference/ data'],
  [/-native(-|\.)[\w-]*\.(png|webp|json|glb)/i, 'native client asset path'],
];

function* walk(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) yield* walk(p);
    else if (EXT.test(name) && s.size < 2_000_000) yield p;
  }
}

let hits = 0;
let files = 0;
for (const r of ROOTS) {
  for (const file of walk(join(root, r))) {
    const rel = relative(root, file).replace(/\\/g, '/');
    if (rel === SELF || rel.includes('/android/app/src/main/assets/')) continue;
    files++;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const [re, label] of BANNED) {
        if (re.test(line)) {
          hits++;
          console.error(`✗ ${rel}:${i + 1}  ${label}\n    ${line.trim().slice(0, 140)}`);
        }
      }
    });
  }
}

if (hits) {
  console.error(`\n${hits} originality violation(s) in ${files} files.`);
  process.exit(1);
}
console.log(`✓ originality gate passed (${files} files scanned).`);
