// Ported from web-coc tests (owner code licence) for the reused helper; import paths adapted.
import { describe, expect, it } from 'vitest';
import { PanFling } from '../src/game/render/pan-fling';

/** A drag from x = 0 at `speed` CSS px per ms, sampled every 16 ms for `ms`. */
function drag(fling: PanFling, speed: number, ms = 160) {
  let t = 0;
  for (; t <= ms; t += 16) fling.track(speed * t, 0, t);
  return t - 16;
}

/** Total glide distance, stepping at `fps` until it stops. */
function glide(fling: PanFling, fps: number) {
  let x = 0,
    frames = 0;
  while (fling.active && frames++ < 10_000) x += fling.step(1000 / fps).x;
  return { x, frames };
}

describe('PanFling', () => {
  it('carries a quick swipe on and slows it to a stop', () => {
    const f = new PanFling();
    const end = drag(f, 1.5);
    expect(f.release(end + 8)).toBe(true);
    const first = f.step(16).x;
    expect(first).toBeGreaterThan(20);
    const second = f.step(16).x;
    expect(second).toBeLessThan(first);
    const total = first + second + glide(f, 60).x;
    // v × τ in all, less what remained below the stop speed (at most STOP_SPEED × τ).
    const full = 1.5 * PanFling.TIME_CONSTANT_MS;
    expect(total).toBeGreaterThan(full - PanFling.STOP_SPEED * PanFling.TIME_CONSTANT_MS);
    expect(total).toBeLessThanOrEqual(full);
    expect(f.active).toBe(false);
  });

  it('covers the same distance at 30, 60 and 120 FPS', () => {
    const at = (fps: number) => {
      const f = new PanFling();
      f.release(drag(f, 2) + 8);
      return glide(f, fps).x;
    };
    expect(at(30)).toBeCloseTo(at(60), 0);
    expect(at(120)).toBeCloseTo(at(60), 0);
  });

  it('ignores slow drags, a finger that rested before lifting, and a tap', () => {
    const slow = new PanFling();
    expect(slow.release(drag(slow, 0.1) + 8)).toBe(false);
    const rested = new PanFling();
    expect(rested.release(drag(rested, 2) + PanFling.REST_MS + 20)).toBe(false);
    const tap = new PanFling();
    tap.track(10, 10, 0);
    expect(tap.release(10)).toBe(false);
    expect(new PanFling().release(0)).toBe(false);
  });

  it('measures only the end of the drag and caps a wild swipe', () => {
    const f = new PanFling();
    // Fast at first, then nearly still for the last 120 ms: no glide.
    for (let t = 0; t <= 100; t += 16) f.track(3 * t, 0, t);
    for (let t = 116; t <= 236; t += 16) f.track(300 + 0.05 * (t - 100), 0, t);
    expect(f.release(244)).toBe(false);

    const wild = new PanFling();
    wild.release(drag(wild, 20) + 8);
    expect(wild.step(1).x).toBeLessThanOrEqual(PanFling.MAX_SPEED);
  });

  it('keeps direction and stops on demand', () => {
    const f = new PanFling();
    let t = 0;
    for (; t <= 160; t += 16) f.track(-t, 2 * t, t);
    expect(f.release(t)).toBe(true);
    const d = f.step(16);
    expect(d.x).toBeLessThan(0);
    expect(d.y).toBeCloseTo(-2 * d.x, 5);
    f.stop();
    expect(f.active).toBe(false);
    expect(f.step(16)).toEqual({ x: 0, y: 0 });
  });
});
