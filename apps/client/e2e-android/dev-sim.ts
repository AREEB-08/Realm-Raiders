/**
 * Cross-runtime determinism on Android (spec §2 / Phase 4): opens /dev/sim inside the installed
 * APK's WebView and checks that every engine version's 200-seed digest equals Node's, and that
 * every golden replay re-simulates exactly.
 *   npx tsx e2e-android/dev-sim.ts
 */
import { _android as android } from '@playwright/test';
import { SUPPORTED_ENGINE_VERSIONS, stabilityDigest } from '@realm/battle-engine';

const expected = SUPPORTED_ENGINE_VERSIONS.map((v) => ({ v, digest: stabilityDigest(200, v).digest }));
for (const e of expected) console.log(`node   v${e.v} ${e.digest}`);

const [device] = await android.devices();
if (!device) throw new Error('no adb device');
console.log(`device ${device.model()} (${device.serial()})`);
await device.shell('am force-stop xyz.realmraiders.app');
await device.shell('am start -n xyz.realmraiders.app/.MainActivity');
const webview = await device.webView({ pkg: 'xyz.realmraiders.app' });
const page = await webview.page();
page.setDefaultTimeout(120_000);
await page.evaluate(() => {
  location.hash = '#/dev/sim';
  location.reload();
});
await page.getByTestId('devsim').filter({ hasText: 'golden-v2-3' }).waitFor();
const text = (await page.getByTestId('devsim').textContent()) ?? '';
console.log(text);
let ok = !/MISMATCH/.test(text);
for (const e of expected) {
  const same = text.includes(`v${e.v} 200-seed digest ${e.digest}`);
  console.log(`webview v${e.v} ${same ? 'MATCHES' : 'DIFFERS'}`);
  ok &&= same;
}
await device.close();
console.log(ok ? 'ANDROID WEBVIEW = NODE ✓' : 'ANDROID WEBVIEW MISMATCH ✗');
process.exit(ok ? 0 : 1);
