import { expect, test, type Page } from '@playwright/test';

type Probe = { scene: string; zoom: number; tileToClient(x: number, y: number): { x: number; y: number }; isFree(x: number, y: number): boolean };

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

const zoomOf = (page: Page) => page.evaluate(() => (window as unknown as { __rr: { probe(): Probe | null } }).__rr.probe()?.zoom ?? 0);

/** A horizontal run of `n` free tiles whose screen points sit over the open map (not under the HUD). */
async function freeRun(page: Page, n: number) {
  return page.evaluate((n) => {
    const p = (window as unknown as { __rr: { probe(): Probe } }).__rr.probe();
    const vh = innerHeight;
    for (let y = 4; y < 26; y++)
      for (let x = 3; x + n < 27; x++) {
        let ok = true;
        for (let i = 0; i < n && ok; i++) {
          const s = p.tileToClient(x + i + 0.5, y + 0.5);
          ok = p.isFree(x + i, y) && s.y > vh * 0.3 && s.y < vh * 0.62 && s.x > 30 && s.x < innerWidth - 30;
          const hit = document.elementFromPoint(s.x, s.y);
          ok = ok && !!hit && hit.tagName === 'CANVAS';
        }
        if (ok) return Array.from({ length: n }, (_, i) => ({ tile: { x: x + i, y }, at: p.tileToClient(x + i + 0.5, y + 0.5) }));
      }
    return null;
  }, n);
}

test('walls: the brush builds at once — tap = one wall, drag = a line, taken tiles skipped; then save', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newCommander(page, 'Mason');
  await page.getByTestId('tab-build').click();
  await page.getByTestId('seal').click();
  await expect(page.getByTestId('seal-status')).toContainText('Saved ✓', { timeout: 20_000 });

  await page.getByTestId('shop').click();
  await page.getByTestId('shop-tab-Walls & Traps').click();
  await page.getByTestId('shop-wall').click();
  await expect(page.getByTestId('wall-bar')).toContainText('Tap or drag on the map to build walls.');
  await expect(page.getByTestId('wall-bar')).toContainText('20/50 walls');
  await page.waitForTimeout(600);

  // Tap: one wall, built straight away.
  const run = await freeRun(page, 7);
  expect(run).not.toBeNull();
  await page.mouse.click(run![0]!.at.x, run![0]!.at.y);
  await expect(page.getByTestId('wall-bar')).toContainText('21/50 walls', { timeout: 10_000 });

  // Drag: the rest of the run in one stroke (the first tile is taken now and is skipped).
  const a = run![0]!.at;
  const b = run![6]!.at;
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 14; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / 14, a.y + ((b.y - a.y) * i) / 14);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await expect(page.getByTestId('wall-bar')).toContainText('27/50 walls', { timeout: 10_000 });
  await page.screenshot({ path: 'test-results/04-build-wall-line.png' });
  for (const t of run!) expect(await page.evaluate(([x, y]) => (window as unknown as { __rr: { probe(): Probe } }).__rr.probe().isFree(x, y), [t.tile.x, t.tile.y])).toBe(false);
  await expect(page.getByTestId('seal-status')).toContainText('Not saved');
  await page.getByTestId('wall-done').click();
  await page.getByTestId('seal').click();
  await expect(page.getByTestId('seal-status')).toContainText('Saved ✓', { timeout: 20_000 });
  expect(errors).toEqual([]);
});

test('shop: buy a Goldworks — a ghost stands on a free spot, tap to move it, ✓ builds it', async ({ page }) => {
  await newCommander(page, 'Trader');
  await page.getByTestId('shop-home').click();
  await page.getByTestId('shop-tab-Resources').click();
  await expect(page.getByTestId('shop-goldworks')).toContainText('Built 1/2');
  await expect(page.getByTestId('shop-goldworks')).toBeEnabled();
  await page.getByTestId('shop-goldworks').click();
  await expect(page.getByTestId('place-bar')).toContainText('Tap the map to move the Goldworks.');
  await page.getByTestId('place-confirm').click();
  await expect(page.getByText('Goldworks is being built.')).toBeVisible();
  await page.getByTestId('shop').click();
  await page.getByTestId('shop-tab-Resources').click();
  await expect(page.getByTestId('shop-goldworks')).toContainText('All built');
});

test('zoom: the mouse wheel over the map changes camera.zoom (nothing swallows it)', async ({ page }) => {
  await newCommander(page, 'Lens');
  await page.waitForTimeout(800);
  const vp = page.viewportSize()!;
  const before = await zoomOf(page);
  await page.mouse.move(vp.width / 2, vp.height / 2);
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(400);
  expect(await zoomOf(page)).toBeGreaterThan(before * 1.1);
});

test('profile: 3D General, badges, on-chain ID card, battles and VERIFY', async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newCommander(page, 'Brannoc');
  // One raid so there is a battle to verify.
  await page.getByTestId('raid').click();
  await page.getByTestId('target-briarholt').click();
  await page.getByTestId('raid-briarholt').click();
  await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 90_000 });
  await page.getByTestId('lock').click();
  await page.getByLabel('Speed').click();
  await expect(page.getByTestId('verified-panel')).toBeVisible({ timeout: 150_000 });
  await page.getByTestId('return-home').click();
  await page.getByTestId('tab-profile').click();
  await expect(page.getByTestId('profile')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('profile-stage').locator('canvas')).toHaveCount(1);
  await expect(page.getByTestId('erc8004-card')).toContainText(/On-chain ID #\d+/);
  await page.getByTestId('profile-tab-Badges').click();
  await expect(page.getByTestId('profile-badges')).toContainText('🏅'); // at least one earned (First Raid)
  await page.getByTestId('profile-tab-Battles').click();
  await expect(page.getByTestId('battle-row').first()).toContainText('vs Briarholt');
  await page.getByTestId('verify-btn').first().click();
  await expect(page.getByText('Checked on your phone ✓ fair').first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: 'test-results/12-profile-verified.png', fullPage: true });
  expect(errors).toEqual([]);
});
