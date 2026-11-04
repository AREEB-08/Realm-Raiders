/**
 * Frame rate on Android (spec F2/F6: forest + 3D sprites, target ≥ 50 FPS on a mid-range phone).
 * Fresh install → guest → first-launch bake ("Forging your army…") → FPS on Home → FPS mid-battle.
 *   npx tsx e2e-android/fps.ts
 * FPS = requestAnimationFrame callbacks per second in the app's WebView (Phaser renders once per frame).
 */
import { _android as android } from '@playwright/test';

const [device] = await android.devices();
if (!device) throw new Error('no adb device');
console.log(`device ${device.model()} (${device.serial()})`);
await device.shell('pm clear xyz.realmraiders.app');
await device.shell('am start -n xyz.realmraiders.app/.MainActivity');
const page = await (await device.webView({ pkg: 'xyz.realmraiders.app' })).page();
page.setDefaultTimeout(120_000);
// Tutorial tips off for the scripted run (a real player sees them once).
await page.evaluate(`localStorage.setItem('realm-raiders-tips', JSON.stringify({ seen: [], off: true }))`);

// Passed as a string: the TS loader would otherwise inject helpers the WebView doesn't have.
const fps = (ms: number) =>
  page.evaluate(`new Promise((resolve) => {
    let n = 0;
    const t0 = performance.now();
    const tick = () => { n++; if (performance.now() - t0 < ${ms}) requestAnimationFrame(tick); else resolve(Math.round((n * 1000) / (performance.now() - t0))); };
    requestAnimationFrame(tick);
  })`) as Promise<number>;

await page.getByTestId('guest').click();
await page.getByTestId('general-name').fill('Bench');
await page.getByTestId('raise').click();
await page.getByTestId('enter-home').click();
await page.getByTestId('raid').waitFor();
const t0 = Date.now();
await page.getByTestId('forging').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
await page.getByTestId('forging').waitFor({ state: 'detached', timeout: 180_000 });
console.log(`first-launch bake ("Forging your army…"): ${((Date.now() - t0) / 1000).toFixed(1)} s`);
await page.waitForTimeout(1500);
console.log(`Home (forest + 3D buildings): ${await fps(5000)} FPS`);
await page.getByTestId('raid').click();
await page.getByTestId('target-kragmoor').click();
await page.getByTestId('raid-kragmoor').click();
await page.waitForFunction(`!document.querySelector('[data-testid=lock]')?.disabled`, null, { timeout: 180_000 });
await page.getByTestId('plan-sapper_breach').click();
await page.getByTestId('lock').click();
await page.waitForTimeout(8000);
console.log(`Battle (Giant Breach on Kragmoor, 3D troops + VFX): ${await fps(6000)} FPS`);
await device.screenshot({ path: 'test-results/android-battle-3d.png' });
await device.close();
