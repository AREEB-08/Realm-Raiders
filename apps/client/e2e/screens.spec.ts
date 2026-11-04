import { expect, test, type Page } from '@playwright/test';

/**
 * Landscape screenshots of every screen at 16:9, 19.5:9 and 20:9 (spec F1 / Phase 3) into
 * docs/screens/<ratio>/. Also a layout guard: no screen may scroll sideways, and the main
 * action of each screen must be inside the viewport. Run with `pnpm screens` (SCREENS=1).
 */
const RATIOS = [
  { name: '16x9', width: 640, height: 360 },
  { name: '19.5x9', width: 780, height: 360 },
  { name: '20x9', width: 800, height: 360 },
] as const;

const OUT = '../../docs/screens';

async function guard(page: Page, label: string, mustSee?: string) {
  const overflow = await page.evaluate(() => {
    const els = [document.documentElement, ...document.querySelectorAll('.screen')] as HTMLElement[];
    return els.some((e) => e.scrollWidth > e.clientWidth + 1);
  });
  expect(overflow, `${label}: horizontal overflow`).toBe(false);
  if (mustSee) {
    const box = await page.getByTestId(mustSee).first().boundingBox();
    const vp = page.viewportSize()!;
    expect(box, `${label}: ${mustSee} missing`).not.toBeNull();
    expect(box!.x >= -1 && box!.y >= -1 && box!.x + box!.width <= vp.width + 1, `${label}: ${mustSee} off screen`).toBe(true);
  }
}

test.describe('landscape screenshots', () => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1 (pnpm screens) to capture the landscape screenshots');
  // Crisp enough to read, small enough for the repo (JPEG, 1.5× density).
  test.use({ deviceScaleFactor: 1.5 });
  for (const r of RATIOS) {
  test(`every screen at ${r.name}`, async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: r.width, height: r.height });
    const shot = async (n: string, mustSee?: string) => {
      await page.waitForTimeout(700);
      await guard(page, `${r.name} ${n}`, mustSee);
      await page.screenshot({ path: `${OUT}/${r.name}/${n}.jpg`, type: 'jpeg', quality: 82 });
    };
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('realm-raiders');
    });
    await page.reload();
    await page.getByTestId('guest').waitFor();
    await shot('01-sign-in', 'guest');
    await page.getByTestId('guest').click();
    await page.getByTestId('general-name').waitFor();
    await page.getByTestId('general-name').fill('Brannoc');
    await shot('02-raise-your-general', 'raise');
    await page.getByTestId('raise').click();
    await page.getByTestId('enter-home').click({ timeout: 90_000 });
    await page.getByTestId('raid').waitFor();
    await shot('03-home', 'raid');
    await page.getByTestId('gems-plus').click();
    await shot('03b-how-to-earn-gems');
    await page.getByLabel('Close').click();
    await page.getByTestId('tab-build').click();
    await shot('04-build-and-seal', 'seal');
    await page.getByTestId('seal').click();
    await expect(page.getByTestId('seal-status')).toContainText('Saved ✓', { timeout: 20_000 });
    await page.getByTestId('shop').click();
    await shot('04b-shop');
    await page.getByLabel('Close').click();
    await page.getByLabel('Back').click();
    await page.getByTestId('raid').click();
    await page.getByTestId('target-briarholt').waitFor();
    await page.waitForTimeout(800);
    await shot('05-find-a-target', 'target-next');
    await page.getByTestId('target-briarholt').click();
    await page.getByTestId('raid-briarholt').click();
    await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 120_000 });
    await shot('06-war-room', 'lock');
    await page.getByTestId('lock').click();
    await page.waitForTimeout(3500);
    await shot('07-battle', 'end-battle');
    await page.getByLabel('Speed').click();
    await page.getByTestId('verified-panel').waitFor({ timeout: 150_000 });
    await shot('08-result', 'return-home');
    await page.getByTestId('return-home').click();
    await page.getByTestId('raid').waitFor();
    await page.getByTestId('tab-night').click();
    await page.getByTestId('draft').click();
    await shot('09-night-captain', 'seal-orders');
    await page.getByTestId('seal-orders').click();
    await page.getByTestId('simulate-night').click();
    await page.getByText(/Autopilot actions/).waitFor({ timeout: 60_000 });
    await shot('10-morning-report');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await page.getByTestId('raid').waitFor();
    await page.getByTestId('tab-profile').click();
    await page.getByTestId('profile').waitFor();
    await page.waitForTimeout(1500);
    await shot('12-profile');
    await page.getByTestId('profile-tab-Battles').click();
    await shot('12b-profile-battles', 'verify-btn');
    await page.getByTestId('profile-tab-Gems').click();
    await page.getByTestId('gems-history').getByText('Daily login').waitFor();
    await shot('12c-profile-gems');
    // 17 — Auto Mode: duration, Auto Orders, running, Auto Log.
    await page.getByLabel('Back').first().click();
    await page.getByTestId('auto-card').click();
    await shot('17-auto-mode-duration', 'auto-next');
    await page.getByTestId('auto-next').click();
    await page.getByTestId('auto-seal').waitFor();
    await page.waitForTimeout(800);
    await shot('17b-auto-orders', 'auto-seal');
    await page.getByTestId('auto-seal').click();
    await page.getByTestId('take-control').waitFor({ timeout: 30_000 });
    await expect(page.getByTestId('ticker')).toContainText(/Raided|Collected|re-sealed|Moved|Upgraded/, { timeout: 120_000 });
    await shot('17c-auto-running', 'take-control');
    await page.getByTestId('auto-card').click();
    await expect(page.getByTestId('auto-log')).toContainText(/Verified ✓/, { timeout: 120_000 });
    await shot('17d-auto-log', 'auto-log');
    await page.getByLabel('Back').first().click();
    await page.getByTestId('take-control').click();
    await page.getByTestId('raid').waitFor();
  });
  }
});

/** 13–16: Play with Friends, Lobby, Live Duel, Duel Result — two phones on the e2e LAN host (port 8790). */
test.describe('landscape screenshots · Play with Friends', () => {
  test.skip(!process.env.SCREENS, 'set SCREENS=1 (pnpm screens) to capture the landscape screenshots');
  for (const r of RATIOS) {
    test(`friends screens at ${r.name}`, async ({ browser }) => {
      test.setTimeout(420_000);
      const open = async (name: string) => {
        const ctx = await browser.newContext({ viewport: { width: r.width, height: r.height }, deviceScaleFactor: 1.5, isMobile: true, hasTouch: true });
        const page = await ctx.newPage();
        await page.goto('/');
        await page.getByTestId('guest').click();
        await page.getByTestId('general-name').fill(name);
        await page.getByTestId('raise').click();
        await page.getByTestId('enter-home').click({ timeout: 90_000 });
        await page.getByTestId('raid').waitFor();
        return page;
      };
      const shot = async (page: Page, n: string, mustSee?: string) => {
        await page.waitForTimeout(700);
        await guard(page, `${r.name} ${n}`, mustSee);
        await page.screenshot({ path: `${OUT}/${r.name}/${n}.jpg`, type: 'jpeg', quality: 82 });
      };
      const a = await open('Ayaan');
      const b = await open('Brannoc');
      for (const p of [a, b]) {
        await p.getByTestId('friends').click();
        if (p === a) {
          await p.getByTestId('no-host').waitFor({ timeout: 30_000 });
          await p.getByTestId('host-ip').fill('127.0.0.1:8790');
          await p.getByTestId('room-code').fill('TEST');
          await shot(p, '13-play-with-friends', 'connect');
        } else {
          await p.getByTestId('host-ip').fill('127.0.0.1:8790');
          await p.getByTestId('room-code').fill('TEST');
        }
        await p.getByTestId('connect').click();
        await p.getByTestId('lobby-players').waitFor({ timeout: 30_000 });
        // Seal on the host so friends can raid and duel.
        await p.getByLabel('Back').first().click();
        await p.getByTestId('tab-build').click();
        await p.getByTestId('seal').click();
        // Three phone-sized pages render at once here, so give the save room on a busy laptop.
        await expect(p.getByTestId('seal-status'))
          .toContainText('Saved ✓', { timeout: 60_000 })
          .catch(async (e) => {
            throw new Error(`base not saved; toasts: ${JSON.stringify(await p.locator('.toast').allInnerTexts())}`, { cause: e });
          });
        await p.getByLabel('Back').first().click();
        await p.getByTestId('room-chip').click();
        await p.getByTestId('lobby-players').waitFor();
      }
      await b.getByTestId('ready').click();
      await expect(a.getByTestId('lobby-player')).toHaveCount(2, { timeout: 15_000 });
      await b.getByTestId('emote-hello').click();
      await a.getByTestId('emote-bubble').first().waitFor({ timeout: 15_000 });
      await shot(a, '14-lobby', 'mode-duel');
      await a.getByTestId('mode-duel').click();
      await b.getByTestId('accept-duel').click({ timeout: 20_000 });
      for (const p of [a, b]) await expect(p.getByTestId('duel-attack-shieldwall')).toBeEnabled({ timeout: 120_000 });
      await shot(a, '15-live-duel', 'duel-attack-shieldwall');
      for (const p of [a, b]) await p.getByTestId('duel-attack-shieldwall').click();
      await a.getByTestId('duel-bar').waitFor({ timeout: 30_000 });
      await a.waitForTimeout(6000);
      await shot(a, '15b-duel-battle', 'duel-bar');
      for (const p of [a, b]) await p.getByLabel('Speed').click();
      await a.getByTestId('duel-verdict').waitFor({ timeout: 200_000 });
      await shot(a, '16-duel-result', 'duel-home');
      await b.getByTestId('duel-verdict').waitFor({ timeout: 60_000 });
      // Leave the room so the next ratio starts with exactly two commanders.
      for (const p of [a, b]) {
        await p.getByTestId('duel-home').click();
        await p.getByTestId('room-chip').click();
        await p.getByTestId('leave-room').click();
        await p.getByTestId('raid').waitFor({ timeout: 30_000 });
        await p.context().close();
      }
    });
  }
});

test('portrait browsers see "Rotate your phone to play"', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 839 });
  await page.goto('/');
  await expect(page.getByTestId('rotate-card')).toBeVisible();
  await expect(page.getByTestId('rotate-card')).toContainText('Rotate your phone to play');
  await page.screenshot({ path: `${OUT}/portrait-rotate.jpg`, type: 'jpeg', quality: 82 });
});
