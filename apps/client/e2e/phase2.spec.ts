import { expect, test, type Page } from '@playwright/test';

type Probe = {
  scene: string;
  zoom: number;
  zoomTarget: number;
  scroll: { x: number; y: number };
  tileToClient(x: number, y: number): { x: number; y: number };
  isFree(x: number, y: number): boolean;
  buildings(): { id: string; type: string; x: number; y: number; size: number }[];
};
type W = { __rr: { probe(): Probe } };

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
  await page.waitForTimeout(600);
}

const probe = <T>(page: Page, f: (p: Probe) => T) => page.evaluate(`(${f.toString()})(window.__rr.probe())`) as Promise<T>;
const zoom = (page: Page) => probe(page, (p) => p.zoom);
/** Wait until the input reached the game (next frames) and the smooth zoom arrived at its target. */
const settled = async (page: Page) => {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => {
    const p = (window as unknown as W).__rr.probe();
    return Math.abs(p.zoom - p.zoomTarget) < 1e-6;
  });
};

/** Mouse-wheel zoom over the middle of the map (the on-screen +/− buttons are gone). */
async function wheel(page: Page, dir: 'in' | 'out', n = 1) {
  const vp = page.viewportSize()!;
  await page.mouse.move(vp.width / 2, vp.height / 2);
  for (let i = 0; i < n; i++) await page.mouse.wheel(0, dir === 'in' ? -400 : 400);
  await settled(page);
}

/** Pinch with two touch points around (x, y), from `from` to `to` px apart (CDP touch events). */
async function pinch(page: Page, x: number, y: number, from: number, to: number) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [{ x: x - d / 2, y, id: 1 }, { x: x + d / 2, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + ((to - from) * i) / 10) });
    await page.waitForTimeout(25);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('home: the base fills the screen; wheel, pinch and double-tap zoom within 0.6×–2.5×', async ({ page }) => {
  await newCommander(page, 'Lens');
  const vp = page.viewportSize()!;
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  // Framed on the base itself (not the whole island of grass): closer than the island fit.
  const z1 = await zoom(page);
  expect(z1).toBeGreaterThan(1.05);
  expect(z1).toBeLessThanOrEqual(2.2);

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -300);
  await settled(page);
  const afterWheel = await zoom(page);
  expect(afterWheel).toBeGreaterThan(z1 * 1.1);

  await pinch(page, cx, cy, 200, 80);
  const afterPinch = await zoom(page);
  expect(afterPinch).toBeLessThan(afterWheel * 0.6);

  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);
  await settled(page);
  expect(await zoom(page)).toBeCloseTo(0.6, 5);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -400);
  await settled(page);
  expect(await zoom(page)).toBeCloseTo(2.5, 5);

  // Back out, then double-tap open ground (far from buildings) to zoom in.
  await wheel(page, 'out', 12);
  const z0 = await zoom(page);
  const spot = await probe(page, (p) => p.tileToClient(27.5, 2.5));
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(80);
  await page.mouse.click(spot.x, spot.y);
  await settled(page);
  expect(await zoom(page)).toBeGreaterThan(z0 * 1.5);
});

test('build: a drag pans (building stays), a 250 ms hold picks it up and moves it', async ({ page }) => {
  await newCommander(page, 'Orrin');
  await page.getByTestId('tab-build').click();
  await page.waitForTimeout(800);
  // Pick a 3×3 building on open map (the editor is already framed on the base).
  const target = await probe(page, (p) => {
    const vh = innerHeight;
    for (const b of p.buildings()) {
      if (b.size !== 3) continue;
      const s = p.tileToClient(b.x + 1.5, b.y + 1.5);
      const hit = document.elementFromPoint(s.x, s.y);
      // On open map (nothing over it) and clear of the top/bottom HUD rows.
      if (hit?.tagName === 'CANVAS' && s.y > 70 && s.y < vh - 100 && s.x > 80 && s.x < innerWidth - 120) return { ...b, s };
    }
    return null;
  });
  expect(target).not.toBeNull();
  const t = target!;
  const scroll0 = await probe(page, (p) => p.scroll);

  // Plain drag from the building: the camera pans, the building does not move.
  await page.mouse.move(t.s.x, t.s.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) {
    await page.mouse.move(t.s.x + i * 8, t.s.y + i * 4);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  const scroll1 = await probe(page, (p) => p.scroll);
  expect(Math.abs(scroll1.x - scroll0.x) + Math.abs(scroll1.y - scroll0.y)).toBeGreaterThan(10);
  const still = await page.evaluate((id) => (window as unknown as W).__rr.probe().buildings().find((b) => b.id === id), t.id);
  expect([still!.x, still!.y]).toEqual([t.x, t.y]);

  // Long-press then drag: the building is picked up and moved (to free ground, 1 tile per step).
  const at = await page.evaluate((b) => (window as unknown as W).__rr.probe().tileToClient(b.x + 1.5, b.y + 1.5), t);
  const dest = await page.evaluate((b) => {
    const p = (window as unknown as W).__rr.probe();
    const free = (x: number, y: number) => {
      for (let yy = y; yy < y + 3; yy++) for (let xx = x; xx < x + 3; xx++) if (!p.isFree(xx, yy) && !(xx >= b.x && xx < b.x + 3 && yy >= b.y && yy < b.y + 3)) return false;
      return true;
    };
    for (let r = 1; r < 8; r++)
      for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const)
        if (b.x + dx >= 2 && b.y + dy >= 2 && b.x + dx + 3 <= 28 && b.y + dy + 3 <= 28 && free(b.x + dx, b.y + dy)) return { x: b.x + dx, y: b.y + dy };
    return null;
  }, t);
  expect(dest).not.toBeNull();
  const to = await page.evaluate((d) => (window as unknown as W).__rr.probe().tileToClient(d.x + 1.5, d.y + 1.5), dest!);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.waitForTimeout(450);
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(at.x + ((to.x - at.x) * i) / 12, at.y + ((to.y - at.y) * i) / 12);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate((id) => (window as unknown as W).__rr.probe().buildings().find((b) => b.id === id), t.id))
    .toMatchObject({ x: dest!.x, y: dest!.y });
});

test('build: a wall tapped at 0.6× and at 2.5× goes up on the tile under the finger', async ({ page }) => {
  await newCommander(page, 'Mason');
  await page.getByTestId('tab-build').click();
  await page.waitForTimeout(600);
  await page.getByTestId('shop').click();
  await page.getByTestId('shop-tab-Walls & Traps').click();
  await page.getByTestId('shop-wall').click();
  for (const level of ['out', 'in'] as const) {
    await wheel(page, level, 14);
    expect(await zoom(page)).toBeCloseTo(level === 'out' ? 0.6 : 2.5, 4);
    const pick = await probe(page, (p) => {
      const vh = innerHeight;
      for (let y = 3; y < 27; y++)
        for (let x = 3; x < 27; x++) {
          if (!p.isFree(x, y)) continue;
          const s = p.tileToClient(x + 0.5, y + 0.5);
          const hit = document.elementFromPoint(s.x, s.y);
          if (hit?.tagName === 'CANVAS' && s.y > vh * 0.3 && s.y < vh * 0.6 && s.x > 40 && s.x < innerWidth - 80) return { x, y, s };
        }
      return null;
    });
    expect(pick).not.toBeNull();
    await page.mouse.click(pick!.s.x, pick!.s.y);
    await expect.poll(() => page.evaluate(([x, y]) => (window as unknown as W).__rr.probe().isFree(x!, y!), [pick!.x, pick!.y])).toBe(false);
  }
});

test('battle: the camera frames the base and zooms with the wheel', async ({ page }) => {
  test.setTimeout(360_000);
  await newCommander(page, 'Sefa');
  await page.getByTestId('raid').click();
  await page.getByTestId('target-briarholt').click();
  await page.getByTestId('raid-briarholt').click();
  await expect(page.getByTestId('lock')).toBeEnabled({ timeout: 180_000 });
  await page.getByTestId('lock').click();
  await expect.poll(() => probe(page, (p) => p.scene), { timeout: 30_000 }).toBe('battle');
  await page.waitForTimeout(500);
  const z0 = await zoom(page);
  expect(z0).toBeGreaterThan(1.05);
  await wheel(page, 'in', 2);
  expect(await zoom(page)).toBeGreaterThan(z0 * 1.3);
  await wheel(page, 'out', 2);
  expect(await zoom(page)).toBeLessThan(z0 * 1.3);
  await page.screenshot({ path: 'test-results/07-battle-zoom.png' });
});
