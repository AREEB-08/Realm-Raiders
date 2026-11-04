/**
 * Captures the extra screenshots used by the explainer PDF (docs/explainer/build.mjs).
 *   1. app dev server, offline realm:  cd apps/client; $env:VITE_BACKEND='local'; $env:VITE_DEMO='1'; npx vite --port 5199
 *   2. landing dev server:             cd apps/landing; npx vite --port 5180
 *   3. node docs/explainer/capture.mjs
 * Screenshots land in docs/explainer/shots/.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { chromium, devices } = await import(pathToFileURL(join(root, 'apps/client/node_modules/@playwright/test/index.mjs')).href);
const out = join(here, 'shots');
mkdirSync(out, { recursive: true });
const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);

const browser = await chromium.launch({
  channel: 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

if (want('app')) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90_000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:5199/');
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('realm-raiders');
  });
  await page.reload();
  await page.getByTestId('guest').waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, '01-signin.png') });
  await page.getByTestId('guest').click();
  await page.getByTestId('general-name').waitFor();
  await page.waitForTimeout(2500);
  await page.getByTestId('general-name').fill('Brannoc');
  await page.screenshot({ path: join(out, '02-general.png') });
  await page.getByTestId('raise').click();
  await page.getByTestId('enter-home').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(out, '02b-card.png') });
  await page.getByTestId('enter-home').click();
  await page.getByTestId('raid').waitFor();
  await page.waitForTimeout(2000);
  await page.getByTestId('raid').click();
  await page.getByTestId('raid-briarholt').waitFor();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(out, '05-targets.png') });
  await page.getByTestId('raid-briarholt').click();
  await page.getByTestId('lock').waitFor();
  await page.waitForFunction(() => !document.querySelector('[data-testid=lock]')?.disabled, null, { timeout: 120_000 });
  await page.getByTestId('lock').click();
  await page.getByText(/Seed locked ✓/).waitFor();
  await page.waitForTimeout(9000);
  await page.screenshot({ path: join(out, '07b-battle.png') });
  console.log(errors.length ? `page errors: ${errors.join(' | ')}` : 'app: no page errors');
  await ctx.close();
}

if (want('devsim')) {
  const ctx = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5199/#/dev/sim');
  await page.waitForFunction(() => /0xc0afd396/.test(document.querySelector('[data-testid=devsim]')?.textContent ?? ''), null, { timeout: 120_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, 'devsim.png') });
  console.log('devsim: ok');
  await ctx.close();
}

if (want('landing')) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5180/');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(out, 'landing.png') });
  await page.screenshot({ path: join(out, 'landing-full.png'), fullPage: true });
  console.log('landing: ok');
  await ctx.close();
}

if (want('cover')) {
  // the landing page's 3D island without its text, for the PDF cover
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await page.goto('http://localhost:5180/');
  await page.addStyleTag({ content: '.hero-copy{visibility:hidden !important}' });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(out, 'cover.png') });
  console.log('cover: ok');
  await ctx.close();
}

if (want('explorer')) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const shots = [
    ['explorer-ledger', 'https://testnet.monadvision.com/address/0xec0e5ae643491f288f0332f695dc2f20fdbd0352'],
    ['explorer-resolved', 'https://testnet.monadvision.com/tx/0xefb8aafffaf215db1c4984783e4ed7af85916f4969d7e2f73e414662ca797a92'],
    ['explorer-agent', 'https://testnet.monadvision.com/tx/0x09501980d9702a808be611e8e01d23d0609b26210e62a0442804374f0e1db5af'],
  ];
  for (const [name, url] of shots) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(9000);
      await page.screenshot({ path: join(out, `${name}.png`) });
      console.log(`${name}: ok (${await page.title()})`);
    } catch (e) {
      console.log(`${name}: failed ${e.message.split('\n')[0]}`);
    }
  }
  await ctx.close();
}

await browser.close();
