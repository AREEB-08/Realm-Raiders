import { expect, test, type Page } from '@playwright/test';

async function newCommander(page: Page, name = 'Brannoc') {
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

test('raid loop 03 → 05 → 06 → 07 → 08 → 03 in mock mode', async ({ page }) => {
  test.setTimeout(420_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newCommander(page);
  await page.screenshot({ path: 'test-results/03-home.png' });
  await page.getByTestId('raid').click();
  await page.getByTestId('target-briarholt').click();
  await page.getByTestId('raid-briarholt').click();
  await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 180_000 });
  await expect(page.getByText(/\d+% wins/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/06-warroom.png' });
  await page.getByTestId('lock').click();
  await expect(page.getByTestId('seed-chip')).toContainText('Fair play ✓');
  await page.getByLabel('Speed').click();
  await page.waitForTimeout(4000);
  await page.screenshot({ path: 'test-results/07-battle.png' });
  await expect(page.getByTestId('verified-panel')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('verified-panel')).toContainText('Fair play verified ✓');
  await page.screenshot({ path: 'test-results/08-result.png' });
  await page.getByTestId('return-home').click();
  await expect(page.getByTestId('raid')).toBeVisible();
  expect(errors).toEqual([]);
});

test('build + seal, then night orders → morning report → architect fix', async ({ page }) => {
  await newCommander(page, 'Ysolt');
  await page.getByTestId('tab-build').click();
  await page.getByTestId('seal').click();
  await expect(page.getByText(/Base saved ✓|Saved ✓/).first()).toBeVisible({ timeout: 20_000 });
  await page.screenshot({ path: 'test-results/04-build.png' });
  await page.getByLabel('Back').click();
  await page.getByTestId('tab-night').click();
  await page.getByTestId('draft').click();
  await page.getByTestId('seal-orders').click();
  await expect(page.getByText(/Sealed until morning/)).toBeVisible();
  await page.screenshot({ path: 'test-results/09-night.png' });
  await page.getByTestId('simulate-night').click();
  await expect(page.getByText(/Autopilot actions/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/within orders ✓/).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/10-report.png', fullPage: true });
  const fix = page.getByTestId('apply-architect');
  if (await fix.isVisible()) {
    await fix.click();
    await page.getByTestId('apply-fix').click();
    await expect(page.getByTestId('seal-status').getByText('Not saved')).toBeVisible();
  }
});

test('profile shows the General, badges and the on-chain ID', async ({ page }) => {
  await newCommander(page, 'Hale');
  await page.getByTestId('tab-profile').click();
  await expect(page.getByText(/On-chain ID #/)).toBeVisible();
  await page.screenshot({ path: 'test-results/12-profile.png', fullPage: true });
});

test('/dev/sim prints the same digests as Node (v1 frozen + v2) and every golden replay matches', async ({ page }) => {
  await page.goto('/#/dev/sim');
  await expect(page.getByTestId('devsim')).toContainText('v1 200-seed digest 0xc0afd3965bc7fff416f2285bea70284ee39fd4dd6a88ed8a996e8f2be1037ebe', { timeout: 60_000 });
  await expect(page.getByTestId('devsim')).toContainText('v2 200-seed digest 0xebb7fe9813a6223fb8e9ba560863721d376528f8d66c396e682fbe65330d5dc6', { timeout: 60_000 });
  await expect(page.getByTestId('devsim')).toContainText('golden-v2-3: OK');
  await expect(page.getByTestId('devsim')).not.toContainText('MISMATCH');
});
