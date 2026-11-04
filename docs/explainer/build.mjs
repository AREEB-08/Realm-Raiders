/**
 * Builds docs/Realm-Raiders-Explained.pdf from explainer.html + diagrams.mjs + chain.json.
 *   node docs/explainer/chain-proof.mjs   # (optional) refresh the on-chain data
 *   node docs/explainer/build.mjs
 * Uses the installed Chrome through Playwright (the same one the e2e tests use).
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as D from './diagrams.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { chromium } = await import(pathToFileURL(join(root, 'apps/client/node_modules/@playwright/test/index.mjs')).href);

const chain = JSON.parse(readFileSync(join(here, 'chain.json'), 'utf8'));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x) => Number(x).toLocaleString('en-US');

/* lines of code per part, counted fresh */
const SKIP = new Set(['node_modules', 'dist', 'build', '.gradle', 'artifacts', 'out', 'cache', 'test-results', 'android', 'fixtures']);
const EXT = /\.(ts|tsx|sol|css|md|mjs)$/;
function count(dir) {
  let files = 0;
  let lines = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (SKIP.has(name)) continue;
      const p = join(d, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (EXT.test(name)) {
        files++;
        lines += readFileSync(p, 'utf8').split('\n').length;
      }
    }
  };
  walk(join(root, dir));
  return { files, lines };
}
const parts = [
  ['apps/client', 'apps/client/src', 'phone app'],
  ['packages/core', 'packages/core/src', 'game services'],
  ['packages/battle-engine', 'packages/battle-engine/src', 'battle rules'],
  ['apps/server', 'apps/server/src', 'server + AI prompts'],
  ['packages/shared', 'packages/shared/src', 'formats, ABIs'],
  ['packages/game-data', 'packages/game-data/src', 'all numbers'],
  ['contracts', 'contracts/src', 'Solidity'],
  ['apps/landing', 'apps/landing/src', 'website'],
].map(([label, dir, what]) => ({ label, what, ...count(dir) }));
const tests = [
  'packages/battle-engine/test',
  'packages/core/test',
  'packages/shared/test',
  'packages/game-data/test',
  'apps/server/test',
  'apps/client/test',
  'apps/client/e2e',
  'contracts/test',
]
  .map((d) => {
    try {
      return count(d);
    } catch {
      return { files: 0, lines: 0 };
    }
  })
  .reduce((a, b) => ({ files: a.files + b.files, lines: a.lines + b.lines }), { files: 0, lines: 0 });
parts.push({ label: 'tests', what: 'all test files', ...tests });
const max = Math.max(...parts.map((p) => p.lines));
const bars = parts
  .map(
    (p) =>
      `<div class="bar"><div><b>${esc(p.label)}</b> <span class="n">${esc(p.what)}</span></div><div class="track"><div class="fill" style="width:${((p.lines / max) * 100).toFixed(1)}%;${p.label === 'tests' ? 'background:#a87b25' : ''}"></div></div><div class="n">${n(p.lines)} lines · ${p.files} files</div></div>`,
  )
  .join('');

const contractRows = chain.contracts
  .map(
    (c) =>
      `<tr><td><b>${esc(c.name)}</b></td><td class="mono">${esc(c.address)}</td><td>${n(c.bytecodeBytes)} bytes</td><td class="ok">${c.sourcify === 'perfect' ? 'perfect match ✓' : esc(c.sourcify)}</td></tr>`,
  )
  .join('');
const txRows = chain.txs
  .map(
    (t) =>
      `<tr><td>${esc(t.label)}</td><td>${esc(t.to ?? '')}</td><td>${t.block ? n(t.block) : ''}</td><td>${t.gasUsed ? n(t.gasUsed) : ''}</td><td class="${t.status === 'success' ? 'ok' : ''}">${esc(t.status)}</td><td class="mono">${esc(t.hash)}</td></tr>`,
  )
  .join('');
const fetched = new Date(chain.fetchedAt);
const fetchedText = `${fetched.toUTCString().replace(/:\d\d GMT/, ' UTC').replace(/^\w+, /, '')}, chain head block ${n(chain.head)}`;

const tokens = {
  LOOP: D.gameLoop(),
  ARCH: D.architecture(),
  PACKAGES: D.packages(),
  ENGINE: D.engineTick(),
  DETERMINISM: D.determinism(),
  SEQUENCE: D.raidSequence(),
  CONTRACTS: D.contracts(),
  OFFICERS: D.officers(),
  NIGHT: D.night(),
  MODES: D.modes(),
  PHASES: D.phases(),
  TESTING: D.testing(),
  BARS: bars,
  CONTRACT_ROWS: contractRows,
  TX_ROWS: txRows,
  FETCHED: esc(fetchedText),
};
let html = readFileSync(join(here, 'explainer.html'), 'utf8');
html = html.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => {
  if (!(k in tokens)) throw new Error(`unknown token ${k}`);
  return tokens[k];
});
const built = join(here, 'explainer.built.html');
writeFileSync(built, html);

const out = process.argv[2] ?? join(root, 'docs', 'Realm-Raiders-Explained.pdf');
const browser = await chromium.launch({ channel: 'chrome' });
// ~ A4 content width (178 mm) so the layout pass measures blocks at their printed size
const page = await browser.newPage({ viewport: { width: 673, height: 1000 } });
await page.goto(pathToFileURL(built).href, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
// Print-layout pass: table header rows → <thead>; keep headings with what follows them.
await page.evaluate(() => {
  for (const t of document.querySelectorAll('table')) {
    const first = t.querySelector('tr');
    if (first && first.querySelector('th') && !t.tHead) t.createTHead().appendChild(first);
  }
  const OK = new Set(['P', 'H2', 'UL', 'OL', 'DIV', 'FIGURE', 'PRE']);
  for (const h1 of document.querySelectorAll('section h1')) {
    if (h1.closest('.cover')) continue;
    const prev = h1.previousElementSibling;
    const num = prev && prev.classList.contains('num') ? prev : null;
    const wrap = document.createElement('div');
    wrap.className = 'chead';
    h1.parentNode.insertBefore(wrap, num ?? h1);
    if (num) wrap.appendChild(num);
    wrap.appendChild(h1);
    let next = wrap.nextElementSibling;
    while (next && OK.has(next.tagName) && next.getBoundingClientRect().height < 320) {
      const after = next.nextElementSibling;
      const isHeading = next.tagName === 'H2';
      wrap.appendChild(next);
      if (!isHeading) break;
      next = after;
    }
  }
  for (const h of document.querySelectorAll('h2, h3')) {
    if (h.closest('.chead') || h.closest('.keep')) continue;
    const next = h.nextElementSibling;
    if (!next || next.tagName === 'TABLE' || next.getBoundingClientRect().height > 240) continue;
    const wrap = document.createElement('div');
    wrap.className = 'keep';
    h.parentNode.insertBefore(wrap, h);
    wrap.appendChild(h);
    wrap.appendChild(next);
  }
});
const missing = await page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.src));
if (missing.length) throw new Error(`images failed: ${missing.join(', ')}`);
const fonts = await page.evaluate(() => [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`));
console.log('fonts:', fonts.join(' | '));
await page.pdf({ path: out, preferCSSPageSize: true, printBackground: true, tagged: true, outline: true });
await browser.close();
console.log(`wrote ${out} (${(statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
