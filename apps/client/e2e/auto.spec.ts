import { expect, test, type Page } from '@playwright/test';

const BLOCKED = 'Auto Mode is running — tap Take Control to play yourself.';

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

test('Auto Mode: pick a duration, seal the orders, watch the officers work, take control (spec F8)', async ({ page }) => {
  test.setTimeout(420_000);
  await newCommander(page, 'Steward');

  // OFF → duration sheet (exact copy) → Auto Orders drafted by Hale → seal.
  await page.getByTestId('auto-card').click();
  await expect(page.getByTestId('auto-duration')).toContainText('How long should your officers take over?');
  for (const [m, g] of [['30 min', 2], ['1 hour', 4], ['2 hours', 8], ['4 hours', 16], ['8 hours', 32]] as const)
    await expect(page.getByTestId('auto-duration')).toContainText(`${m} ${g} Gems`);
  await page.getByTestId('auto-30').click();
  await page.getByTestId('auto-next').click();
  const orders = page.getByTestId('auto-orders');
  await expect(orders).toContainText('Your officers will follow these rules and nothing else.');
  await expect(orders).toContainText('Raids per hour: 2');
  await expect(orders).toContainText('Only raid if win chance is at least: 70%');
  await expect(orders).toContainText('Keep Gold in reserve: 30%');
  await expect(orders).toContainText("Orders are locked on Monad, so the officers can't break them.");
  await page.getByTestId('auto-seal').click();

  // Running: chip, glow, banner, TAKE CONTROL; the first block is paid.
  await expect(page.getByTestId('auto-chip')).toHaveText(/^AUTO · \d+:\d\d left$/, { timeout: 30_000 });
  await expect(page.getByTestId('take-control')).toBeVisible();
  await expect(page.locator('.auto-glow')).toHaveCount(1);

  // Manual play waits (RAID! has become TAKE CONTROL; the Shop says why it's closed).
  await expect(page.getByTestId('raid')).toHaveCount(0);
  await page.getByTestId('shop-home').click();
  await expect(page.getByTestId('take-control')).toBeVisible();
  await expect(page.locator('.toast', { hasText: BLOCKED })).toBeVisible();

  // The Auto Log fills in by itself: the seal, the Architect's fix, the re-seal and a verified raid.
  await page.getByTestId('auto-card').click();
  const log = page.getByTestId('auto-log');
  await expect(log).toContainText('Orders locked on Monad ✓');
  await expect(log).toContainText(/Raided .+ — \d★, \d+% · Verified ✓/, { timeout: 240_000 });
  await expect(log).toContainText('within orders ✓');
  await expect(page.getByTestId('auto-entry').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/17-auto-log.png' });
  await page.getByLabel('Back').click();
  await expect(page.getByTestId('take-control')).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/17-auto-home.png' });

  // TAKE CONTROL stops at once and manual play is back.
  await page.getByTestId('take-control').click();
  await expect(page.getByTestId('auto-chip')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByTestId('auto-card')).toContainText('OFF');
  await page.getByTestId('raid').click();
  await expect(page.getByTestId('target-briarholt')).toBeVisible({ timeout: 30_000 });

  // Profile → Gems shows the charge in the history.
  await page.getByLabel('Back').click();
  await page.getByTestId('tab-profile').click();
  await page.getByRole('button', { name: 'Gems', exact: true }).click();
  await expect(page.getByTestId('gems-history')).toContainText('−2Auto Mode 30 min');
});

test('Gems history in Profile lists every change', async ({ page }) => {
  test.setTimeout(120_000);
  await newCommander(page, 'Ledger');
  await page.getByTestId('tab-profile').click();
  await page.getByRole('button', { name: 'Gems', exact: true }).click();
  const h = page.getByTestId('gems-history');
  await expect(h).toContainText('Daily login');
  await expect(h).toContainText('Starting Gems');
});
