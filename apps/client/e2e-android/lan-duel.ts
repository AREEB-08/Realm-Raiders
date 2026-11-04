/**
 * Play with Friends on Android (spec F9): the APK on an emulator + a browser "phone", both against
 * one LAN host, through the lobby and a full Live Duel.
 *   pnpm apk && adb install -r android/app/build/outputs/apk/debug/app-debug.apk
 *   npx tsx e2e-android/lan-duel.ts          (an emulator must be running)
 * The host (room DUEL, mock chain) and the web app (vite :5199) are started here. The emulator
 * reaches the host at 10.0.2.2 — the same code path as a real phone typing the laptop's LAN IP.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { _android as android, chromium, devices, type Page } from '@playwright/test';

const ROOT = join(import.meta.dirname, '..');
const PORT = 8790;
const procs: ChildProcess[] = [];
const run = (cmd: string, cwd: string, env: Record<string, string>) => {
  const p = spawn(cmd, { cwd, env: { ...process.env, ...env }, shell: true, stdio: 'ignore' });
  procs.push(p);
  return p;
};
const until = async (url: string, ms = 90_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} never answered`);
};
const step = (s: string) => console.log(`· ${s}`);

try {
  run('pnpm --dir ../server exec tsx src/index.ts', ROOT, { PORT: String(PORT), HOST: '0.0.0.0', DB_FILE: ':memory:', CHAIN_MODE: 'mock', AGENTS_MODE: 'offline', LAN_ROOM: 'DUEL', LAN_NAME: 'Test laptop', QUIET: '1' });
  run('npx vite --port 5199 --strictPort', ROOT, { VITE_BACKEND: 'local', VITE_DEMO: '1' });
  await until(`http://127.0.0.1:${PORT}/health`);
  await until('http://localhost:5199');
  step('host up (room DUEL) and web app up');

  const [device] = await android.devices();
  if (!device) throw new Error('no adb device — start the emulator first');
  console.log(`device ${device.model()} (${device.serial()})`);
  await device.shell('pm clear xyz.realmraiders.app');
  await device.shell('am start -n xyz.realmraiders.app/.MainActivity');
  const a = await (await device.webView({ pkg: 'xyz.realmraiders.app' })).page();
  a.setDefaultTimeout(120_000);
  // Tutorial tips off for the scripted run (a real player sees them once).
  await a.evaluate(`localStorage.setItem('realm-raiders-tips', JSON.stringify({ seen: [], off: true }))`);
  const browser = await chromium.launch({ channel: 'chrome' });
  const b = await (await browser.newContext({ ...devices['Pixel 7 landscape'], baseURL: 'http://localhost:5199' })).newPage();
  b.setDefaultTimeout(120_000);
  await b.goto('/');

  const raise = async (p: Page, name: string) => {
    await p.getByTestId('guest').click();
    await p.getByTestId('general-name').fill(name);
    await p.getByTestId('raise').click();
    await p.getByTestId('enter-home').click();
    await p.getByTestId('raid').waitFor();
  };
  const join = async (p: Page, host: string) => {
    await p.getByTestId('friends').click();
    await p.getByTestId('host-ip').fill(host);
    await p.getByTestId('room-code').fill('DUEL');
    await p.getByTestId('connect').click();
    await p.getByTestId('lobby-players').waitFor();
    await p.getByLabel('Back').first().click();
    await p.getByTestId('tab-build').click();
    await p.getByTestId('seal').click();
    await p.getByText('Saved ✓').first().waitFor({ timeout: 30_000 });
    await p.getByLabel('Back').first().click();
    await p.getByTestId('room-chip').click();
    await p.getByTestId('lobby-players').waitFor();
  };
  await raise(a, 'Droid');
  await raise(b, 'Browser');
  step('both Generals raised');
  await join(a, `10.0.2.2:${PORT}`);
  await join(b, `127.0.0.1:${PORT}`);
  await a.getByText('Room DUEL · 2 commanders').waitFor({ timeout: 30_000 });
  step('both in room DUEL, bases sealed on the host');

  await b.getByTestId('emote-good_luck').click();
  await a.getByTestId('emote-bubble').first().waitFor({ timeout: 20_000 });
  step('emote from the browser reached the phone');

  await a.getByTestId('mode-duel').click();
  await b.getByTestId('accept-duel').click({ timeout: 30_000 });
  for (const p of [a, b]) await p.waitForFunction(`!document.querySelector('[data-testid=duel-attack-shieldwall]')?.disabled`, null, { timeout: 180_000 });
  step('duel live: one shared seed, War Rooms ready on both');
  for (const p of [a, b]) await p.getByTestId('duel-attack-shieldwall').click();
  await a.getByTestId('duel-bar').waitFor({ timeout: 30_000 });
  await device.screenshot({ path: 'test-results/android-duel-live.png' });
  for (const p of [a, b]) await p.getByLabel('Speed').click();
  for (const p of [a, b]) await p.getByTestId('duel-verdict').waitFor({ timeout: 240_000 });
  const va = await a.getByTestId('duel-verdict').innerText();
  const vb = await b.getByTestId('duel-verdict').innerText();
  const score = await a.getByTestId('duel-score').innerText();
  const recorded = (await a.getByTestId('duel-result').innerText()).includes('Duel recorded on Monad ✓');
  await device.screenshot({ path: 'test-results/android-duel-result.png' });
  console.log(`ANDROID ${va} · BROWSER ${vb} · ${score} · recorded ${recorded ? '✓' : '✗'}`);
  if (!['DEFEAT,VICTORY', 'DRAW,DRAW'].includes([va, vb].sort().join(',')) || !recorded) throw new Error('verdicts do not agree');
  console.log('LAN DUEL ON ANDROID ✓');
  await browser.close();
  await device.close();
} finally {
  for (const p of procs) {
    if (process.platform === 'win32' && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill();
  }
}
