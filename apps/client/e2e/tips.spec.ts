import { expect, test } from '@playwright/test';

test('tutorial tips for the new features: one at a time, remembered, and can be turned off', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => localStorage.setItem('realm-raiders-tips-force', '1'));
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.removeItem('realm-raiders-tips');
    indexedDB.deleteDatabase('realm-raiders');
  });
  await page.reload();
  await page.getByTestId('guest').click();
  await page.getByTestId('general-name').fill('Pupil');
  await page.getByTestId('raise').click();
  await page.getByTestId('enter-home').click({ timeout: 60_000 });
  await expect(page.getByTestId('tip-text')).toContainText('Pinch to zoom');
  await page.getByTestId('tip-ok').click();
  await expect(page.getByTestId('tip-text')).toContainText('New: Auto Mode');
  await page.getByTestId('tip-ok').click();
  await expect(page.getByTestId('tip-text')).toContainText('New: Play with Friends');
  // Remembered across a reload.
  await page.reload();
  await expect(page.getByTestId('raid')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('tip-text')).toContainText('New: Play with Friends');
  await page.getByTestId('tip-off').click();
  await expect(page.getByTestId('tip')).toHaveCount(0);
  await page.getByTestId('tab-build').click();
  await expect(page.getByTestId('tip')).toHaveCount(0);
});
