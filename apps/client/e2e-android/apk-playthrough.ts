/**
 * Plays the installed APK on a connected device/emulator (adb), through its WebView, in landscape:
 *   npx tsx e2e-android/apk-playthrough.ts
 * Fresh install → guest → General → home → seal → raid Briarholt → "Verified" → night orders →
 * morning report → Auto Mode (seal orders, watch, TAKE CONTROL) → profile Gems.
 * Screenshots land in test-results/apk-*.png. (Code passed to the page is a string: the TS
 * loader would otherwise inject helpers the WebView doesn't have.)
 */
import { _android as android } from '@playwright/test';

const shot = async (device: Awaited<ReturnType<typeof android.devices>>[number], name: string) =>
  device.screenshot({ path: `test-results/apk-${name}.png` });

const [device] = await android.devices();
if (!device) throw new Error('no adb device');
console.log(`device ${device.model()} (${device.serial()})`);
await device.shell('pm clear xyz.realmraiders.app');
await device.shell('am start -n xyz.realmraiders.app/.MainActivity');
const webview = await device.webView({ pkg: 'xyz.realmraiders.app' });
const page = await webview.page();
page.setDefaultTimeout(60_000);
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now();
const step = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
// Tutorial tips off for the scripted run (a real player sees them once).
await page.evaluate(`localStorage.setItem('realm-raiders-tips', JSON.stringify({ seen: [], off: true }))`);
const enabled = (id: string, ms = 120_000) => page.waitForFunction(`!document.querySelector('[data-testid=${id}]')?.disabled`, null, { timeout: ms });

await page.getByTestId('guest').waitFor();
step(`sign-in screen: ${await page.locator('.small-note').last().textContent()}`);
await page.getByTestId('guest').click();
await page.getByTestId('general-name').fill('Brannoc');
await shot(device, '02-general');
await page.getByTestId('raise').click();
await page.getByTestId('enter-home').click({ timeout: 90_000 });
step('General raised (ERC-8004 agent card)');
await page.getByTestId('raid').waitFor();
await page.waitForTimeout(2500);
await shot(device, '03-home');

await page.getByTestId('tab-build').click();
await page.getByTestId('seal').click();
await page.getByText('Saved ✓').first().waitFor({ timeout: 60_000 });
step('base sealed');
await shot(device, '04-build');
await page.getByLabel('Back').first().click();

await page.getByTestId('raid').click();
await page.getByTestId('target-briarholt').click();
await page.getByTestId('raid-briarholt').click();
await enabled('lock');
await shot(device, '06-warroom');
step('War Room ready (150 practice raids)');
await page.getByTestId('lock').click();
await page.getByTestId('seed-chip').waitFor({ timeout: 60_000 });
step('seed locked on chain');
await page.getByLabel('Speed').click();
await page.waitForTimeout(6000);
await shot(device, '07-battle');
await page.getByTestId('verified-panel').waitFor({ timeout: 150_000 });
step(`result: ${(await page.getByTestId('verified-panel').textContent())?.slice(0, 60)}`);
await page.waitForTimeout(2500);
await shot(device, '08-result');
await page.getByTestId('return-home').click();

await page.getByTestId('tab-night').click();
await page.getByTestId('draft').click();
await page.getByTestId('seal-orders').click();
await page.getByText(/Sealed until morning/).waitFor({ timeout: 60_000 });
step('night orders sealed');
await shot(device, '09-night');
await page.getByTestId('simulate-night').click();
await page.getByText(/Autopilot actions/).waitFor({ timeout: 120_000 });
step('morning report');
await shot(device, '10-report');
await page.getByRole('button', { name: 'Dismiss' }).click();

// Auto Mode: 30 minutes, Hale's orders, sealed; the officers start at once; then TAKE CONTROL.
await page.getByTestId('auto-card').click();
await page.getByTestId('auto-30').click();
await page.getByTestId('auto-next').click();
await page.getByTestId('auto-seal').click();
await page.getByTestId('take-control').waitFor({ timeout: 60_000 });
step(`auto mode on: ${await page.getByTestId('auto-chip').textContent()}`);
await page.waitForTimeout(8000);
await shot(device, '17-auto');
await page.getByTestId('take-control').click();
await page.getByTestId('raid').waitFor({ timeout: 30_000 });
step('took control');

await page.getByTestId('tab-profile').click();
await page.getByTestId('profile-tab-Gems').click();
await page.getByTestId('gems-history').getByText('Auto Mode 30 min').waitFor({ timeout: 30_000 });
await page.waitForTimeout(1500);
await shot(device, '12-profile-gems');
step('profile: Gems history');
console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'no page errors');
await device.close();
