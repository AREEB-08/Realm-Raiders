import { devices, expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Play with Friends (spec F9) with two phones (two browser contexts) against one LAN host
 * (`pnpm dev:lan` equivalent on port 8790, room TEST — started by playwright.config.ts).
 */
const HOST = '127.0.0.1:8790';

async function phone(browser: Browser, name: string): Promise<Page> {
  const ctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByTestId('guest').click();
  await page.getByTestId('general-name').fill(name);
  await page.getByTestId('raise').click();
  await page.getByTestId('enter-home').click({ timeout: 60_000 });
  await expect(page.getByTestId('raid')).toBeVisible();
  return page;
}

async function join(page: Page) {
  await page.getByTestId('friends').click();
  await expect(page.getByText('Same Wi-Fi, same realm.')).toBeVisible();
  await page.getByTestId('host-ip').fill(HOST);
  await page.getByTestId('room-code').fill('test');
  await page.getByTestId('connect').click();
  await expect(page.getByTestId('lobby-players')).toBeVisible({ timeout: 30_000 });
}

async function seal(page: Page) {
  await page.getByLabel('Back').first().click();
  await page.getByTestId('tab-build').click();
  await page.getByTestId('seal').click();
  await expect(page.getByTestId('seal-status')).toContainText('Saved ✓', { timeout: 20_000 });
  await page.getByLabel('Back').first().click();
  await page.getByTestId('room-chip').click();
  await expect(page.getByTestId('lobby-players')).toBeVisible();
}

test('two phones: lobby + emotes, raid a friend while they watch live, then a Live Duel on one seed', async ({ browser }) => {
  test.setTimeout(600_000);
  const a = await phone(browser, 'Ayaan');
  const b = await phone(browser, 'Brannoc');

  // Join the same room; each phone keeps its own commander on the host.
  await join(a);
  await join(b);
  await expect(a.getByText('Room TEST · 2 commanders')).toBeVisible({ timeout: 15_000 });
  await expect(a.getByTestId('lobby-player')).toHaveCount(2);
  await a.getByTestId('ready').click();
  await expect(b.getByTestId('ready-badge')).toHaveCount(1, { timeout: 15_000 });
  await b.getByTestId('emote-good_luck').click();
  await expect(a.getByTestId('emote-bubble')).toHaveText('Good luck!', { timeout: 15_000 });

  await seal(a);
  await seal(b);

  // Raid your friend: Brannoc gets the alert and watches live.
  await a.getByTestId('mode-raid').click();
  const friendRaid = a.locator('[data-testid^="raid-p:"]');
  await expect(friendRaid).toBeEnabled({ timeout: 30_000 });
  await friendRaid.click();
  await expect(a.getByTestId('lock')).toBeEnabled({ timeout: 120_000 });
  await a.getByTestId('lock').click();
  await expect(b.getByTestId('raid-alert')).toContainText('Ayaan is raiding you!', { timeout: 30_000 });
  await b.getByTestId('watch-live').click();
  await expect(b.getByTestId('spectate')).toContainText('LIVE', { timeout: 30_000 });
  await b.waitForTimeout(4000);
  await b.screenshot({ path: 'test-results/15-spectate.png' });
  await a.getByLabel('Speed').click();
  await expect(a.getByTestId('verified-panel')).toBeVisible({ timeout: 150_000 });
  await expect(b.getByTestId('spectate-end')).toBeVisible({ timeout: 150_000 });
  await b.getByRole('button', { name: /BACK TO ISLAND/ }).click();

  // Live Duel: invite → accept → one shared seed → both attack → result on both phones.
  await a.getByTestId('return-home').click();
  await a.getByTestId('room-chip').click();
  await b.getByTestId('room-chip').click();
  await a.getByTestId('mode-duel').click();
  await expect(b.getByTestId('duel-invite')).toContainText('Ayaan challenges you to a Live Duel!', { timeout: 20_000 });
  await b.getByTestId('accept-duel').click();
  for (const p of [a, b]) {
    await expect(p.getByTestId('duel-intro')).toContainText('Fair duel ✓', { timeout: 120_000 });
    await expect(p.getByTestId('duel-attack-shieldwall')).toBeEnabled({ timeout: 120_000 });
  }
  await a.screenshot({ path: 'test-results/15-duel.png' });
  for (const p of [a, b]) await p.getByTestId('duel-attack-shieldwall').click();
  await expect(a.getByTestId('duel-bar')).toBeVisible({ timeout: 30_000 });
  await a.screenshot({ path: 'test-results/15-duel-live.png' });
  for (const p of [a, b]) await p.getByLabel('Speed').click();
  for (const p of [a, b]) await expect(p.getByTestId('duel-verdict')).toBeVisible({ timeout: 200_000 });
  const verdicts = [await a.getByTestId('duel-verdict').innerText(), await b.getByTestId('duel-verdict').innerText()].sort();
  expect(verdicts.join(',')).toMatch(/^(DEFEAT,VICTORY|DRAW,DRAW)$/);
  await expect(a.getByTestId('duel-result')).toContainText('Duel recorded on Monad ✓');
  await a.screenshot({ path: 'test-results/16-duel-result.png' });
});

test('no host on the Wi-Fi: the search says so and explains how to host', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/');
  await page.getByTestId('guest').click();
  await page.getByTestId('general-name').fill('Solo');
  await page.getByTestId('raise').click();
  await page.getByTestId('enter-home').click({ timeout: 60_000 });
  await page.getByTestId('friends').click();
  await expect(page.getByTestId('no-host')).toContainText('No host found. Ask your friend to run the game server on the same Wi-Fi, then try again.', { timeout: 30_000 });
  await page.getByTestId('how-to-host').click();
  await expect(page.getByTestId('host-help')).toContainText('pnpm dev:lan');
});
