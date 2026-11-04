// Ported from web-coc tests (owner code licence) for the reused helper; import paths adapted.
import { describe, expect, it } from 'vitest';
import { RenderQuality } from '../src/game/render/render-quality';

function driver(density = 2) {
  const quality = new RenderQuality();
  let now = 0;
  quality.reset(now);
  return {
    quality,
    run(duration: number, delta: number, enabled = true, interval?: number) {
      const end = now + duration;
      while (now < end) quality.sample((now += delta), enabled, density, interval);
    },
  };
}

describe('adaptive canvas density', () => {
  it('keeps native quality for fast frames and isolated hiccups', () => {
    const d = driver();
    for (let i = 0; i < 20; i++) {
      d.run(1000, 1000 / 60);
      d.run(100, 100);
    }
    expect(d.quality.scale).toBe(1);
  });
  it('reduces sustained pressure in steps down to half a pixel per CSS pixel', () => {
    const d = driver();
    d.run(7500, 40);
    expect(d.quality.scale).toBe(0.75);
    d.run(30000, 40);
    expect(d.quality.scale).toBe(0.25);
    const phone = driver(3);
    phone.run(60000, 40);
    expect(phone.quality.scale).toBe(1 / 6);
    const normal = driver(1);
    normal.run(30000, 40);
    expect(normal.quality.scale).toBe(0.5);
  });
  it('recovers a severely overloaded 1× display rather than resetting every slow frame', () => {
    const d = driver(1);
    d.run(8400, 1400);
    expect(d.quality.scale).toBe(0.5);
    d.run(8400, 1400);
    expect(d.quality.scale).toBe(0.5);
    d.run(60000, 1400);
    expect(d.quality.scale).toBe(0.5);
    d.run(45000, 1000 / 60);
    expect(d.quality.scale).toBe(1);
  });
  it('ignores loads and background gaps, and restores quality cautiously', () => {
    const d = driver();
    d.run(30000, 40, false);
    d.run(30000, 5000);
    expect(d.quality.scale).toBe(1);
    d.run(7500, 40);
    expect(d.quality.scale).toBe(0.75);
    d.run(10000, 1000 / 60);
    expect(d.quality.scale).toBe(0.75);
    d.run(15000, 1000 / 60);
    expect(d.quality.scale).toBe(1);
  });
  it('reads a deliberate frame cap as its pace, not as pressure', () => {
    const capped = 1000 / 30;
    const d = driver(3);
    // The idle village caps the loop at 30 FPS: a phone left alone keeps native density.
    d.run(60000, capped, true, capped);
    expect(d.quality.scale).toBe(1);
    // Real overload under the cap still lowers density...
    d.run(7500, 80, true, capped);
    expect(d.quality.scale).toBe(0.75);
    // ...a steady capped pace restores it...
    d.run(25000, capped, true, capped);
    expect(d.quality.scale).toBe(1);
    // ...and lifting the cap restarts the measurement instead of counting the switch.
    d.run(4000, 1000 / 60);
    expect(d.quality.scale).toBe(1);
    // Without the cap, the same 30 FPS pace counts as pressure.
    const uncapped = driver(3);
    uncapped.run(7500, capped);
    expect(uncapped.quality.scale).toBe(0.75);
  });
  it('halves density under severe sustained phone pressure and respects the frame cap', () => {
    const phone = driver(3);
    phone.run(7500, 80);
    expect(phone.quality.scale).toBe(0.5);
    phone.run(7500, 80);
    expect(phone.quality.scale).toBe(0.25);
    phone.run(7500, 80);
    expect(phone.quality.scale).toBe(1 / 6);
    const capped = driver(3);
    capped.run(7500, 120, true, 1000 / 30);
    expect(capped.quality.scale).toBe(0.5);
  });
  it('waits for another frame before treating one long stall as sustained pressure', () => {
    const quality = new RenderQuality();
    quality.reset(0);
    for (let now = 10; now < 5000; now += 10) quality.sample(now, true, 3);
    quality.sample(6990, true, 3);
    expect(quality.scale).toBe(1);
    quality.sample(7000, true, 3);
    expect(quality.scale).toBe(1);
  });
});
