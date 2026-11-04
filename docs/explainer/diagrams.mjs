/** Hand-laid SVG diagrams for the explainer PDF. Each export is an SVG string. */

export const C = {
  ink: '#16323d',
  teal: '#1d5566',
  ember: '#d9652b',
  brass: '#a87b25',
  monad: '#5b45e0',
  ai: '#7a52c7',
  green: '#2f7d4f',
  red: '#b23a3a',
  muted: '#5b6b72',
};
const MARKERS = { ink: C.ink, ember: C.ember, monad: C.monad, ai: C.ai, muted: C.muted, teal: C.teal, green: C.green, brass: C.brass, red: C.red };

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

function defs() {
  return `<defs>${Object.entries(MARKERS)
    .map(
      ([k, c]) =>
        `<marker id="ah-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`,
    )
    .join('')}</defs>`;
}

export function svg(w, h, body) {
  return `<svg class="diagram" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" role="img">${defs()}${body}</svg>`;
}

export function text(x, y, s, { size = 12, weight = 400, fill = C.ink, anchor = 'middle', italic = false, family = '' } = {}) {
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${italic ? ' font-style="italic"' : ''}${family ? ` font-family="${family}"` : ''}>${esc(s)}</text>`;
}

/** A box with a centred bold title and optional sub-lines. */
export function box(x, y, w, h, { title, sub, fill = '#ffffff', stroke = C.ink, dash = false, r = 8, tsize = 12.5, ssize = 10.5, tfill = C.ink, sfill = C.muted, sw = 1.4 } = {}) {
  const t = lines(title);
  const s = lines(sub);
  const lh = tsize * 1.2;
  const slh = ssize * 1.25;
  const total = t.length * lh + s.length * slh;
  let cy = y + h / 2 - total / 2 + tsize * 0.85;
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash ? ' stroke-dasharray="5 4"' : ''}/>`;
  for (const l of t) {
    out += text(x + w / 2, cy, l, { size: tsize, weight: 650, fill: tfill });
    cy += lh;
  }
  cy += (slh - lh) * 0.3;
  for (const l of s) {
    out += text(x + w / 2, cy, l, { size: ssize, fill: sfill });
    cy += slh;
  }
  return out;
}

/** A big container with a header at the top-left. */
export function group(x, y, w, h, { title, sub, fill = '#f6f8f9', stroke = C.ink, r = 14, dash = false }) {
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="1.8"${dash ? ' stroke-dasharray="6 4"' : ''}/>`;
  out += text(x + 14, y + 22, title, { size: 12.5, weight: 800, fill: stroke, anchor: 'start' });
  if (sub) out += text(x + 14, y + 37, sub, { size: 10.5, fill: C.muted, anchor: 'start' });
  return out;
}

export function arrow(pts, { color = 'ink', dash = false, both = false, width = 1.8 } = {}) {
  const c = MARKERS[color] ?? color;
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${width}"${dash ? ' stroke-dasharray="5 4"' : ''} marker-end="url(#ah-${color})"${both ? ` marker-start="url(#ah-${color})"` : ''}/>`;
}

export function badge(x, y, n, color = C.ember, r = 10) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>` + text(x, y + 4, n, { size: 11.5, weight: 800, fill: '#fff' });
}

/* ------------------------------------------------------------------ */
/* 1. The big picture                                                  */
/* ------------------------------------------------------------------ */
export function architecture() {
  let b = '';
  // phone
  b += group(10, 10, 240, 420, { title: "PLAYER'S PHONE", sub: 'Android app (APK)', fill: '#eaf3f5', stroke: C.teal });
  const rows = [62, 120, 178, 236, 294, 352];
  const phone = [
    ['Screens 01–12', 'React: menus, buttons, chat'],
    ['Island & battle view', 'Phaser: isometric 2D drawing'],
    ['3D General & sea-dragon', 'Three.js: built from code'],
    ['Battle engine (copy)', 'runs in a Web Worker'],
    ['Offline realm', 'whole game on the phone'],
    ['Save & settings', 'IndexedDB / local storage'],
  ];
  phone.forEach(([t, s], i) => (b += box(25, rows[i], 210, 48, { title: t, sub: s, dash: i === 4 })));
  // server
  b += group(310, 10, 220, 420, { title: 'GAME SERVER', sub: 'Node.js, runs on the PC', fill: '#fbf1e6', stroke: C.ember });
  const server = [
    ['API: HTTP + WebSocket', 'Fastify'],
    ['Game services', 'the shared "core" package'],
    ['Database', 'SQLite via Drizzle'],
    ['Battle checker pool', 're-runs every replay'],
    ['AI officer runner', 'prompts, checks, fallbacks'],
    ['Relayer + indexer', 'sends & reads transactions'],
  ];
  server.forEach(([t, s], i) => (b += box(325, rows[i], 190, 48, { title: t, sub: s })));
  // AI
  b += group(590, 10, 160, 150, { title: 'AI MODEL', sub: 'the officers’ "voice"', fill: '#f3eefb', stroke: C.ai });
  b += box(603, 58, 134, 44, { title: 'Qwen3 4B', sub: 'local, via Ollama', stroke: C.ai });
  b += box(603, 108, 134, 42, { title: 'Hosted Qwen', sub: 'optional, tried first', stroke: C.ai, dash: true });
  // Monad
  b += group(590, 180, 160, 250, { title: 'MONAD TESTNET', sub: 'public blockchain', fill: '#efedfd', stroke: C.monad });
  ['RealmLedger', 'RealmDuels', 'RealmBadges', 'ERC-8004 Identity', 'ERC-8004 Reputation'].forEach(
    (t, i) => (b += box(603, 226 + i * 40, 134, 32, { title: t, stroke: C.monad, tsize: 11.5 })),
  );
  // shared bar
  b += group(10, 470, 740, 118, { title: 'SHARED PACKAGES: the exact same code runs on the phone and on the server', fill: '#f5f1e6', stroke: C.brass });
  const pk = [
    ['game-data', 'every number in the game'],
    ['battle-engine', 'the battle rules'],
    ['shared', 'formats, hashes, contract ABIs'],
    ['core', 'game services (raid, build, night…)'],
  ];
  pk.forEach(([t, s], i) => (b += box(25 + i * 182, 502, 170, 70, { title: t, sub: s, stroke: C.brass })));
  // arrows
  b += arrow([[250, 86], [310, 86]], { color: 'teal', both: true, width: 2.2 });
  b += badge(280, 70, 1, C.teal);
  b += arrow([[530, 318], [562, 318], [562, 80], [590, 80]], { color: 'ai', both: true, width: 2.2 });
  b += badge(562, 200, 2, C.ai);
  b += arrow([[530, 376], [590, 376]], { color: 'monad', both: true, width: 2.2 });
  b += badge(560, 360, 3, C.monad);
  b += arrow([[130, 470], [130, 433]], { color: 'brass', dash: true, width: 2 });
  b += arrow([[420, 470], [420, 433]], { color: 'brass', dash: true, width: 2 });
  b += badge(150, 452, 4, C.brass);
  b += badge(440, 452, 4, C.brass);
  return svg(760, 596, b);
}

/* ------------------------------------------------------------------ */
/* 2. Game loop                                                        */
/* ------------------------------------------------------------------ */
export function gameLoop() {
  let b = '';
  b += text(12, 18, 'DAY', { size: 12, weight: 800, fill: C.ember, anchor: 'start' });
  const day = [
    ['Build', 'place & upgrade', '04'],
    ['Seal', 'lock layout on chain', '04'],
    ['Pick a target', 'scout 3 islands', '05'],
    ['War Room', '150 practice battles', '06'],
    ['Raid', 'live battle', '07'],
    ['Verified!', 'result on chain', '08'],
  ];
  const w = 108;
  const gap = 17;
  day.forEach(([t, s, n], i) => {
    const x = 10 + i * (w + gap);
    b += box(x, 28, w, 62, { title: t, sub: s, stroke: C.ember, fill: '#fff7f1' });
    b += text(x + w - 8, 42, n, { size: 9.5, weight: 700, fill: C.ember, anchor: 'end' });
    if (i < day.length - 1) b += arrow([[x + w + 1, 59], [x + w + gap - 1, 59]], { color: 'ember' });
  });
  b += text(12, 132, 'NIGHT', { size: 12, weight: 800, fill: C.monad, anchor: 'start' });
  const night = [
    ['Night orders', 'you set the rules', '09'],
    ['Seal orders', 'hash on chain', '09'],
    ['Raiders attack', 'while you sleep', '—'],
    ['AI defends', 'only inside orders', '—'],
    ['Morning Report', 'what happened', '10'],
  ];
  night.forEach(([t, s, n], i) => {
    const x = 10 + (i + 0.5) * (w + gap);
    b += box(x, 142, w, 62, { title: t, sub: s, stroke: C.monad, fill: '#f3f1fe' });
    b += text(x + w - 8, 156, n, { size: 9.5, weight: 700, fill: C.monad, anchor: 'end' });
    if (i < night.length - 1) b += arrow([[x + w + 1, 173], [x + w + gap - 1, 173]], { color: 'monad' });
  });
  // day -> night and back
  b += arrow([[10 + 5 * (w + gap) + w / 2, 91], [10 + 5 * (w + gap) + w / 2, 112], [10 + 0.5 * (w + gap) + w / 2, 112], [10 + 0.5 * (w + gap) + w / 2, 140]], { color: 'muted', dash: true });
  b += text(380, 108, 'evening', { size: 10, fill: C.muted, italic: true });
  b += arrow([[10 + 4.5 * (w + gap) + w, 173], [754, 173], [754, 18], [64, 18], [64, 26]], { color: 'muted', dash: true });
  b += text(560, 13, 'next morning: rebuild, upgrade, raid again', { size: 10, fill: C.muted, italic: true });
  // any time
  b += box(10, 222, 742, 34, { title: 'Any time: AUTO MODE (17), officers play under orders locked on chain · FRIENDS (13–16), raid or duel on one Wi-Fi', stroke: C.brass, fill: '#fbf5e6', tsize: 11.5 });
  return svg(762, 262, b);
}

/* ------------------------------------------------------------------ */
/* 3. Package map                                                      */
/* ------------------------------------------------------------------ */
export function packages() {
  let b = '';
  const y = 20;
  b += box(10, y, 130, 58, { title: 'game-data', sub: 'all numbers', stroke: C.brass });
  b += box(180, y, 140, 58, { title: 'battle-engine', sub: 'the rules', stroke: C.brass });
  b += box(360, y, 120, 58, { title: 'shared', sub: 'formats & hashes', stroke: C.brass });
  b += box(520, y, 120, 58, { title: 'core', sub: 'game services', stroke: C.brass });
  b += arrow([[140, y + 29], [178, y + 29]], { color: 'brass' });
  b += arrow([[320, y + 29], [358, y + 29]], { color: 'brass' });
  b += arrow([[480, y + 29], [518, y + 29]], { color: 'brass' });
  b += box(560, 118, 190, 52, { title: 'apps/client', sub: 'the phone app', stroke: C.teal });
  b += box(560, 186, 190, 52, { title: 'apps/server', sub: 'the game server', stroke: C.ember });
  b += arrow([[640, y + 29], [700, y + 29], [700, 116]], { color: 'brass' });
  b += arrow([[700, 116 + 54], [700, 184]], { color: 'muted', dash: true });
  b += box(10, 118, 250, 52, { title: 'contracts', sub: 'Solidity, deployed to Monad', stroke: C.monad });
  b += box(280, 118, 250, 52, { title: 'apps/landing', sub: 'download website', stroke: C.muted });
  b += box(10, 186, 250, 52, { title: 'tools', sub: 'verify-replay, live-run, asset import', stroke: C.muted });
  b += box(280, 186, 250, 52, { title: 'scripts', sub: 'originality check, pre-commit guard', stroke: C.muted });
  b += text(380, 263, 'Arrows read "is used by". The app and the server both build on the same four packages.', { size: 10.5, fill: C.muted, italic: true });
  return svg(760, 272, b);
}

/* ------------------------------------------------------------------ */
/* 4. Engine tick                                                      */
/* ------------------------------------------------------------------ */
export function engineTick() {
  let b = '';
  b += group(10, 10, 170, 300, { title: 'INPUTS', fill: '#fff7f1', stroke: C.ember });
  ['Island layout', 'Your army', 'Seed (locked first)', 'Your taps + times'].forEach(
    (t, i) => (b += box(22, 46 + i * 64, 146, 50, { title: t, sub: ['the sealed base', 'troops & levels', 'the "dice"', 'deploy, rally, end'][i], stroke: C.ember })),
  );
  b += group(220, 10, 320, 300, { title: 'EVERY TICK (1/20 of a second)', fill: '#eaf3f5', stroke: C.teal });
  const steps = ['Put new troops on the map', 'Each unit picks a target', 'Find the way (flow fields)', 'Move one step', 'Towers and traps fire', 'Arrows & stones land: damage', 'General & rally effects', 'Update stars and % destroyed'];
  steps.forEach((s, i) => {
    const y = 48 + i * 31;
    b += badge(244, y + 11, i + 1, C.teal, 9);
    b += `<rect x="258" y="${y}" width="268" height="23" rx="5" fill="#fff" stroke="${C.teal}" stroke-width="1"/>`;
    b += text(268, y + 16, s, { size: 11.5, anchor: 'start' });
  });
  b += arrow([[536, 290], [552, 290], [552, 48], [540, 48]], { color: 'teal', dash: true });
  b += text(562, 172, 'repeat', { size: 10, fill: C.teal, italic: true, anchor: 'start' });
  b += text(562, 185, 'up to 3,600', { size: 10, fill: C.teal, italic: true, anchor: 'start' });
  b += text(562, 198, 'ticks (3 min)', { size: 10, fill: C.teal, italic: true, anchor: 'start' });
  b += group(620, 10, 140, 300, { title: 'OUTPUT', fill: '#f3f1fe', stroke: C.monad });
  ['Stars, %, loot', 'Replay file', 'Replay hash'].forEach(
    (t, i) => (b += box(632, 50 + i * 84, 116, 62, { title: t, sub: ['the result', 'all inputs, tiny', 'a 32-byte fingerprint'][i], stroke: C.monad })),
  );
  b += arrow([[180, 160], [218, 160]], { color: 'ember', width: 2.2 });
  b += arrow([[580, 110], [618, 110]], { color: 'monad', width: 2.2 });
  return svg(770, 320, b);
}

/* ------------------------------------------------------------------ */
/* 5. Same answer everywhere                                           */
/* ------------------------------------------------------------------ */
export function determinism() {
  let b = '';
  const dev = [
    ['PC: Node.js 22', 'the server'],
    ['Desktop Chrome', 'the web build'],
    ['Android phone', 'the APK WebView'],
  ];
  dev.forEach(([t, s], i) => {
    const x = 10 + i * 172;
    b += box(x, 10, 156, 50, { title: t, sub: s, stroke: [C.ember, C.teal, C.green][i] });
    b += arrow([[x + 78, 60], [x + 78, 92]], { color: 'muted' });
  });
  b += box(10, 94, 500, 44, { title: '200 random battles → one combined fingerprint', sub: 'pnpm digest   /   the hidden /dev/sim page on the phone', stroke: C.ink, fill: '#f6f8f9' });
  b += arrow([[260, 138], [260, 160]], { color: 'green', width: 2.2 });
  b += `<rect x="10" y="162" width="500" height="40" rx="8" fill="#eaf6ee" stroke="${C.green}" stroke-width="1.6"/>`;
  b += text(260, 187, '0xc0afd3965bc7fff4…ed8a996e8f2be1037ebe  (identical on all three)', { size: 12, weight: 700, fill: C.green, family: 'Consolas, monospace' });
  return svg(520, 210, b);
}

/* ------------------------------------------------------------------ */
/* 6. A raid, step by step (sequence)                                  */
/* ------------------------------------------------------------------ */
export function raidSequence() {
  let b = '';
  const X = { phone: 165, server: 420, chain: 652 };
  const head = (x, t, s, c, fill) => box(x - 95, 8, 190, 46, { title: t, sub: s, stroke: c, fill });
  b += head(X.phone, 'PHONE', 'the player', C.teal, '#eaf3f5');
  b += head(X.server, 'SERVER', 'the referee', C.ember, '#fbf1e6');
  b += head(X.chain, 'MONAD', 'the public record', C.monad, '#efedfd');
  const top = 56;
  const bottom = 610;
  for (const x of Object.values(X)) b += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="#b9c3c7" stroke-width="1.4" stroke-dasharray="4 4"/>`;
  let y = 84;
  const step = 48;
  let n = 1;
  const msg = (from, to, label, color, sub) => {
    const x1 = X[from];
    const x2 = X[to];
    const dir = x2 > x1 ? 1 : -1;
    b += arrow([[x1 + dir * 4, y], [x2 - dir * 4, y]], { color });
    const mid = (x1 + x2) / 2;
    b += text(mid, y - 7, label, { size: 11.5, weight: 600 });
    if (sub) b += text(mid, y + 14, sub, { size: 10, fill: C.muted, italic: true });
    b += badge(Math.min(x1, x2) - 22 + (from === 'phone' && to === 'server' ? 0 : 0), y, n++, MARKERS[color]);
    y += step;
  };
  const self = (who, label, sub, color) => {
    const x = X[who];
    b += `<rect x="${x - 115}" y="${y - 16}" width="230" height="${sub ? 36 : 26}" rx="6" fill="#fff" stroke="${MARKERS[color]}" stroke-width="1.3"/>`;
    b += text(x, y + 1, label, { size: 11.5, weight: 600 });
    if (sub) b += text(x, y + 14, sub, { size: 10, fill: C.muted, italic: true });
    b += badge(x - 129, y + 2, n++, MARKERS[color]);
    y += step;
  };
  self('chain', 'Defender’s base already sealed', 'BaseSealed (layout hash)', 'monad');
  msg('phone', 'server', '"Raid Briarholt" + my random nonce', 'teal');
  msg('server', 'chain', 'commit: hash of a secret', 'ember', 'BattleCommitted');
  msg('server', 'chain', 'reveal secret a few blocks later', 'ember', 'SeedLocked: seed mixes secret + nonce + block data');
  msg('server', 'phone', 'here is the locked seed', 'ember');
  self('phone', 'Battle plays with that seed', 'every tap is recorded with its tick', 'teal');
  msg('phone', 'server', 'replay file (a few hundred bytes)', 'teal');
  self('server', 'Re-run the replay in a worker', 'same stars, same %, same hash?', 'ember');
  msg('server', 'chain', 'record result hash', 'ember', 'BattleResolved + reputation + badges');
  msg('server', 'phone', '"Verified on Monad ✓" + explorer links', 'ember');
  self('phone', 'Anyone can re-check later', 'Profile → verify, or pnpm verify-replay --chain', 'teal');
  return svg(780, 620, b);
}

/* ------------------------------------------------------------------ */
/* 7. Contracts                                                        */
/* ------------------------------------------------------------------ */
export function contracts() {
  let b = '';
  b += box(10, 150, 150, 80, { title: ['Relayer wallet', '(on the server)'], sub: ['signs & pays gas', 'for every player'], stroke: C.ember, fill: '#fbf1e6' });
  const list = [
    ['RealmLedger', ['sealBase · commitBattle · revealSeed', 'recordResult · recordDefence', 'commitPolicy · logAutopilot'], 'The raid notary: bases, seeds, results, night orders'],
    ['RealmDuels', ['recordDuel (both replay hashes, winner)'], 'Live Duel results between friends'],
    ['RealmBadges', ['award (soulbound: cannot be moved)'], 'Achievement badges'],
    ['ERC-8004 Identity', ['register(agentURI)'], 'Each General’s on-chain ID card'],
    ['ERC-8004 Reputation', ['giveFeedback(agentId, score…)'], 'A verified score after every battle'],
  ];
  let y = 10;
  list.forEach(([name, fns, what], i) => {
    const h = 30 + fns.length * 14 + 16;
    const canon = i >= 3;
    b += `<rect x="250" y="${y}" width="500" height="${h}" rx="9" fill="${canon ? '#f7f7fb' : '#efedfd'}" stroke="${C.monad}" stroke-width="1.5"${canon ? ' stroke-dasharray="5 4"' : ''}/>`;
    b += text(264, y + 20, name, { size: 13, weight: 800, fill: C.monad, anchor: 'start' });
    b += text(736, y + 20, what, { size: 10.5, fill: C.muted, anchor: 'end', italic: true });
    fns.forEach((f, j) => (b += text(264, y + 38 + j * 14, f, { size: 10.5, anchor: 'start', family: 'Consolas, monospace' })));
    b += arrow([[160, 190], [205, 190], [205, y + h / 2], [248, y + h / 2]], { color: 'ember', width: 1.4 });
    y += h + 10;
  });
  b += text(500, y + 8, 'Solid boxes: written for this game.  Dashed: the official shared ERC-8004 registries.', { size: 10, fill: C.muted, italic: true });
  return svg(760, y + 16, b);
}

/* ------------------------------------------------------------------ */
/* 8. AI officers pipeline                                             */
/* ------------------------------------------------------------------ */
export function officers() {
  let b = '';
  b += box(10, 70, 140, 80, { title: ['A question', '+ the facts'], sub: ['live game numbers,', 'tool results'], stroke: C.ink, fill: '#f6f8f9' });
  b += group(190, 10, 220, 200, { title: 'TRY THE MODELS IN ORDER', fill: '#f3eefb', stroke: C.ai });
  b += box(205, 48, 190, 42, { title: '1. Hosted Qwen', sub: 'if an API key is set', stroke: C.ai, dash: true });
  b += box(205, 98, 190, 42, { title: '2. Backup provider', sub: 'if one is set', stroke: C.ai, dash: true });
  b += box(205, 148, 190, 48, { title: '3. Local Qwen3 4B', sub: 'Ollama, thinking off: ~2 s', stroke: C.ai });
  b += group(450, 10, 170, 200, { title: 'CHECK THE ANSWER', fill: '#eaf6ee', stroke: C.green });
  ['in 4 seconds?', 'valid JSON shape?', 'every number real?', 'action allowed?'].forEach((t, i) => {
    b += `<rect x="463" y="${44 + i * 40}" width="144" height="30" rx="6" fill="#fff" stroke="${C.green}" stroke-width="1.2"/>`;
    b += text(535, 64 + i * 40, t, { size: 11.5, weight: 600 });
  });
  b += box(660, 30, 100, 64, { title: ['Show the', 'answer'], stroke: C.green, fill: '#eaf6ee' });
  b += box(660, 126, 100, 84, { title: ['Field', 'manual'], sub: ['rule-based', 'answer'], stroke: C.red, fill: '#fbeeee' });
  b += arrow([[150, 110], [188, 110]], { color: 'ink' });
  b += arrow([[410, 110], [448, 110]], { color: 'ai' });
  b += arrow([[620, 62], [658, 62]], { color: 'green' });
  b += text(639, 54, 'yes', { size: 10, fill: C.green });
  b += arrow([[620, 168], [658, 168]], { color: 'red' });
  b += text(639, 160, 'no', { size: 10, fill: C.red });
  b += text(385, 236, 'One repair retry on bad JSON. Answers are cached and rate-limited. The officer is tagged "(field manual)" when the rules answered.', { size: 10.5, fill: C.muted, italic: true });
  return svg(770, 246, b);
}

/* ------------------------------------------------------------------ */
/* 9. Night                                                            */
/* ------------------------------------------------------------------ */
export function night() {
  let b = '';
  const items = [
    ['Draft orders', ['Night Captain', 'suggests rules']],
    ['You seal them', ['hash on chain:', 'PolicyCommitted']],
    ['Raids come in', ['NPC raiding parties,', 'no General']],
    ['Autopilot acts', ['repair, strike back,', 'storm-shield']],
    ['Morning Report', ['what happened,', 'with proofs']],
  ];
  items.forEach(([t, s], i) => {
    const x = 10 + i * 152;
    b += box(x, 10, 132, 70, { title: t, sub: s, stroke: C.monad, fill: '#f3f1fe' });
    if (i < items.length - 1) b += arrow([[x + 133, 45], [x + 150, 45]], { color: 'monad' });
  });
  b += box(314, 108, 132, 54, { title: 'DefenseRecorded', sub: 'each raid, on chain', stroke: C.monad, tsize: 11.5 });
  b += box(466, 108, 296, 54, { title: 'Checked against the sealed orders', sub: ['allowed → AutopilotAction on chain', 'not allowed → refused, shown in the report'], stroke: C.green, fill: '#eaf6ee', tsize: 11.5 });
  b += arrow([[380, 80], [380, 106]], { color: 'muted', dash: true });
  b += arrow([[532, 80], [532, 106]], { color: 'muted', dash: true });
  return svg(770, 170, b);
}

/* ------------------------------------------------------------------ */
/* 11. Online / offline                                                */
/* ------------------------------------------------------------------ */
export function modes() {
  let b = '';
  b += box(10, 70, 140, 60, { title: 'App starts', sub: 'reads its server list', stroke: C.ink, fill: '#f6f8f9' });
  b += box(190, 70, 170, 60, { title: 'Is a server there?', sub: '10.0.2.2:8787, then LAN IP', stroke: C.ink, fill: '#fff' });
  b += arrow([[150, 100], [188, 100]], { color: 'ink' });
  b += box(420, 8, 340, 72, { title: 'ONLINE: real server', sub: ['live AI officers, SQLite, real Monad transactions,', 'explorer links on every "✓" chip'], stroke: C.green, fill: '#eaf6ee' });
  b += box(420, 120, 340, 72, { title: 'OFFLINE REALM: all on the phone', sub: ['same core code + in-memory store + mock ledger,', 'rule-based officers, battles checked in a Web Worker'], stroke: C.brass, fill: '#fbf5e6' });
  b += arrow([[360, 92], [390, 92], [390, 44], [418, 44]], { color: 'green' });
  b += text(398, 64, 'yes', { size: 10, fill: C.green, anchor: 'start' });
  b += arrow([[360, 108], [390, 108], [390, 156], [418, 156]], { color: 'brass' });
  b += text(398, 140, 'no', { size: 10, fill: C.brass, anchor: 'start' });
  return svg(770, 200, b);
}

/* ------------------------------------------------------------------ */
/* 12. Build phases                                                    */
/* ------------------------------------------------------------------ */
export function phases() {
  let b = '';
  const ph = [
    ['0', 'Scaffold', 'monorepo, emulator'],
    ['1', 'Engine', 'data + battle rules'],
    ['2', 'Offline loop', 'island → battle'],
    ['3', 'Server', 'API, DB, auth'],
    ['4', 'Contracts', 'relayer, chain'],
    ['5', '3D General', 'creator, portraits'],
    ['6', 'AI officers', 'prompts, guards'],
    ['7', 'Night', 'orders, report'],
    ['8', 'Clan siege', 'later removed'],
    ['9', 'Profile', 'reputation, badges'],
    ['10', 'Landing', 'website'],
    ['11', 'Polish', 'demo hardening'],
    ['★', 'Go live', 'Monad + APK test'],
  ];
  const x0 = 48;
  const step = (744 - 2 * x0) / (ph.length - 1);
  b += `<line x1="${x0}" y1="40" x2="${744 - x0}" y2="40" stroke="${C.brass}" stroke-width="3"/>`;
  ph.forEach(([n, t, s], i) => {
    const x = x0 + i * step;
    const live = n === '★';
    b += `<circle cx="${x}" cy="40" r="15" fill="${live ? C.monad : C.ember}"/>`;
    b += text(x, 45, n, { size: live ? 14 : 12, weight: 800, fill: '#fff' });
    const low = i % 2 === 1;
    if (low) b += `<line x1="${x}" y1="56" x2="${x}" y2="90" stroke="#c9d1d4" stroke-width="1"/>`;
    b += text(x, low ? 104 : 72, t, { size: 11, weight: 700 });
    b += text(x, low ? 117 : 85, s, { size: 9, fill: C.muted });
  });
  return svg(744, 124, b);
}

/* ------------------------------------------------------------------ */
/* 13. Testing layers                                                  */
/* ------------------------------------------------------------------ */
export function testing() {
  let b = '';
  const layers = [
    ['Live run on Monad testnet', '22 real transactions, all "success", Auto Mode included; verify-replay --chain passes 5/5', C.monad, '#efedfd'],
    ['Real APK on an Android emulator', 'Playwright drives the installed app: sign-in → raid → night → Auto Mode → profile', C.green, '#eaf6ee'],
    ['Browser end-to-end tests (20)', 'raid loop, walls, Shop, zoom, night + report, Auto Mode, two-phone duel, /dev/sim', C.teal, '#eaf3f5'],
    ['Golden replays + determinism digest', '3 recorded battles must replay to the same hash; 200-seed digest pinned', C.brass, '#fbf5e6'],
    ['200 unit tests', 'engine 77 · core 39 · client 38 · server 18 · game-data 10 · shared 9 · contracts 9', C.ember, '#fbf1e6'],
  ];
  layers.forEach(([t, s, c, f], i) => {
    const inset = (layers.length - 1 - i) * 34;
    const w = 760 - 2 * inset;
    b += box(10 + inset, 10 + i * 56, w - 20 + 20, 48, { title: t, sub: s, stroke: c, fill: f });
  });
  return svg(780, 10 + layers.length * 56, b);
}
