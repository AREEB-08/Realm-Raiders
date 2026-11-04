import { describe, expect, it } from 'vitest';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  approach,
  clampScroll,
  clampZoom,
  doubleTapZoom,
  fitScale,
  isDoubleTap,
  screenOf,
  scrollToPin,
  wheelFactor,
  worldAt,
  zoomAbout,
} from '../src/game/render/camera-math';

const view = { w: 1600, h: 720 };

describe('camera maths (F3)', () => {
  it('keeps zoom within 0.6×–2.5×', () => {
    expect([ZOOM_MIN, ZOOM_MAX]).toEqual([0.6, 2.5]);
    expect(clampZoom(0.1)).toBe(0.6);
    expect(clampZoom(9)).toBe(2.5);
    expect(clampZoom(1.3)).toBe(1.3);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it('fits the island in portrait and landscape', () => {
    const box = { w: 2040, h: 1200 };
    expect(fitScale({ w: 412, h: 915 }, box)).toBeCloseTo((412 / 2040) * 0.92, 6); // width-bound
    expect(fitScale({ w: 915, h: 412 }, box)).toBeCloseTo((412 / 1200) * 0.92, 6); // height-bound
  });

  it('worldAt and screenOf are inverses (Phaser: screen = w/2 + zoom·(world − scroll − w/2))', () => {
    const scroll = { x: 300, y: -120 };
    for (const s of [{ x: 0, y: 0 }, { x: 800, y: 360 }, { x: 1599, y: 719 }]) {
      const w = worldAt(scroll, 0.37, view, s);
      const back = screenOf(scroll, 0.37, view, w);
      expect(back.x).toBeCloseTo(s.x, 9);
      expect(back.y).toBeCloseTo(s.y, 9);
    }
  });

  it('zooms about the fingers: the world point under them does not move', () => {
    const scroll = { x: 100, y: 50 };
    const s = { x: 1200, y: 200 };
    const before = worldAt(scroll, 0.4, view, s);
    const next = zoomAbout(scroll, 0.4, 1.0, view, s);
    const after = worldAt(next, 1.0, view, s);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('pinch pans with the midpoint: the pinned world point follows the fingers', () => {
    const pin = { x: 1480, y: 840 };
    const mid = { x: 500, y: 600 };
    const scroll = scrollToPin(pin, 0.8, view, mid);
    const s = screenOf(scroll, 0.8, view, pin);
    expect(s.x).toBeCloseTo(mid.x, 9);
    expect(s.y).toBeCloseTo(mid.y, 9);
  });

  it('clamps to the map + border, and centres when zoomed far out', () => {
    const b = { minX: 0, minY: 0, maxX: 3000, maxY: 2000 };
    // Far out: the view (1600/0.2 = 8000 wide) is wider than the bounds → centred.
    const out = clampScroll({ x: 99999, y: -99999 }, 0.2, view, b);
    const c = worldAt(out, 0.2, view, { x: view.w / 2, y: view.h / 2 });
    expect(c.x).toBeCloseTo(1500, 6);
    expect(c.y).toBeCloseTo(1000, 6);
    // Close in: the visible rect stays inside the bounds.
    const near = clampScroll({ x: 99999, y: 99999 }, 2, view, b);
    const br = worldAt(near, 2, view, { x: view.w, y: view.h });
    expect(br.x).toBeCloseTo(3000, 6);
    expect(br.y).toBeCloseTo(2000, 6);
    const tl = worldAt(clampScroll({ x: -99999, y: -99999 }, 2, view, b), 2, view, { x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(0, 6);
    expect(tl.y).toBeCloseTo(0, 6);
  });

  it('smooths toward the target independent of frame rate, then snaps', () => {
    const at60 = Array.from({ length: 6 }).reduce<number>((z) => approach(z, 2, 1000 / 60), 1);
    const at30 = Array.from({ length: 3 }).reduce<number>((z) => approach(z, 2, 1000 / 30), 1);
    expect(at60).toBeCloseTo(at30, 9);
    expect(at60).toBeGreaterThan(1.5);
    let z = 1;
    for (let i = 0; i < 200; i++) z = approach(z, 2, 16);
    expect(z).toBe(2);
  });

  it('double-tap zooms in, and back out when already close', () => {
    expect(doubleTapZoom(1)).toBe(2);
    expect(doubleTapZoom(0.6)).toBe(1.6);
    expect(doubleTapZoom(2.2)).toBe(1);
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, 250, 20, 18)).toBe(true);
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, 400, 10, 10)).toBe(false);
    expect(isDoubleTap({ t: 0, x: 10, y: 10 }, 100, 90, 10)).toBe(false);
    expect(isDoubleTap(null, 100, 10, 10)).toBe(false);
  });

  it('wheel up zooms in, wheel down zooms out, bounded per notch', () => {
    expect(wheelFactor(-100)).toBeGreaterThan(1);
    expect(wheelFactor(100)).toBeLessThan(1);
    expect(wheelFactor(-10_000)).toBe(1.5);
    expect(wheelFactor(10_000)).toBe(0.66);
  });
});
