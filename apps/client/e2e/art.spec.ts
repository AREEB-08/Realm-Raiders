import { writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

type RR = { __rr: { art(): Promise<string[]>; atlas(kind: string): string | null; probe(): { scene: string } | null } };

async function newCommander(page: Page, name: string) {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('realm-raiders');
  });
  await page.reload();
  await page.getByTestId('guest').click();
  await page.getByTestId('general-name').fill(name);
  await page.getByTestId('raise').click();
  await page.getByTestId('enter-home').click({ timeout: 60_000 });
  await expect(page.getByTestId('raid')).toBeVisible();
}

const baked = (page: Page) => page.evaluate(() => (window as unknown as RR).__rr.art());

test('3D army: baked once ("Forging your army…"), cached in IndexedDB, played in battle', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('realm-raiders-art'));
  await newCommander(page, 'Forge');
  await expect.poll(() => baked(page), { timeout: 180_000, intervals: [1000] }).toHaveLength(7);
  // The atlases are in IndexedDB (one per troop + this General).
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const req = indexedDB.open('realm-raiders-art');
              req.onsuccess = () => {
                const tx = req.result.transaction('atlas', 'readonly');
                const c = tx.objectStore('atlas').count();
                c.onsuccess = () => resolve(c.result);
                c.onerror = () => resolve(-1);
              };
              req.onerror = () => resolve(-1);
            }),
        ),
      { timeout: 30_000 },
    )
    .toBe(7);
  for (const kind of ['shield', 'longbow', 'ravager', 'mage', 'drake', 'general']) {
    const url = await page.evaluate((k) => (window as unknown as RR).__rr.atlas(k), kind);
    expect(url, kind).toMatch(/^data:image\/png;base64,/);
    writeFileSync(`test-results/atlas-${kind}.png`, Buffer.from(url!.split(',')[1]!, 'base64'));
  }
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/03-home-3d.png' });
  // A later launch loads from the cache instead of baking again.
  const t0 = Date.now();
  await page.reload();
  await expect(page.getByTestId('raid')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => baked(page), { timeout: 30_000 }).toHaveLength(7);
  expect(Date.now() - t0).toBeLessThan(30_000);
  // Battle plays the baked sprites.
  await page.getByTestId('raid').click();
  await page.getByTestId('raid-kragmoor').click();
  await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId('plan-sapper_breach').click();
  await page.getByTestId('lock').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as RR).__rr.probe()?.scene), { timeout: 30_000 }).toBe('battle');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'test-results/07-battle-3d.png' });
});

test('WebGL bake unavailable → the game keeps the 2D drawings and still plays', async ({ page }) => {
  test.setTimeout(240_000);
  // The baker asks for preserveDrawingBuffer; Phaser does not. Refuse only the baker's contexts.
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: { preserveDrawingBuffer?: boolean }) {
      if (type.startsWith('webgl') && attrs?.preserveDrawingBuffer) return null;
      return (orig as (t: string, a?: unknown) => RenderingContext | null).call(this, type, attrs);
    } as typeof orig;
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('realm-raiders-art'));
  await newCommander(page, 'Plain');
  await page.waitForTimeout(4000);
  expect(await baked(page)).toEqual([]);
  await expect(page.getByTestId('forging')).toHaveCount(0);
  await page.getByTestId('raid').click();
  await page.getByTestId('target-briarholt').click();
  await page.getByTestId('raid-briarholt').click();
  await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 120_000 });
  await page.getByTestId('lock').click();
  await page.getByLabel('Speed').click();
  await expect(page.getByTestId('verified-panel')).toBeVisible({ timeout: 150_000 });
  expect(errors).toEqual([]);
});
