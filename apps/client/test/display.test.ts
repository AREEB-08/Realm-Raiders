// Ported from web-coc tests (owner code licence) for the reused helper; import paths adapted.
import { describe, expect, it } from 'vitest';
import { displaySize } from '../src/game/render/display';


describe('display buffer allocation', () => {
  it('uses native pixels for Retina desktops, triple-density phones and fractional browser zoom', () => {
    expect(displaySize(1440, 960, 2)).toEqual({ width: 2880, height: 1920 });
    expect(displaySize(390, 844, 3)).toEqual({ width: 1170, height: 2532 });
    expect(displaySize(801, 601, 1.25)).toEqual({ width: 1001, height: 751 });
    expect(displaySize(1440, 960, 0.8)).toEqual({ width: 1152, height: 768 });
  });
  it('fits huge displays and narrow GPU limits without stretching the aspect ratio', () => {
    for (const [width, height, dpr, limit] of [
      [7680, 4320, 3, 8192],
      [390, 844, 3, 2048],
      [100, 12000, 2, 4096],
    ]) {
      const size = displaySize(width, height, dpr, limit);
      expect(size.width * size.height).toBeLessThanOrEqual(16_000_000);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(limit);
      expect(Math.abs(size.width - (size.height * width) / height)).toBeLessThan(2);
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});

// Exercise measurement separately from physical resizing while a finger remains down.
