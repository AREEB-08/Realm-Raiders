import { describe, expect, it } from 'vitest';
import { ANIM_COLS, ANIM_START, BAKED_DIRS, DIR8, dir8Of } from '../src/three/bake-layout';

describe('baked sprite atlas layout (spec F6)', () => {
  it('has the spec frame counts: idle 4, walk 8, attack 6, death 4', () => {
    expect(ANIM_COLS).toBe(22);
    expect(ANIM_START).toEqual({ idle: 0, walk: 4, attack: 12, death: 18 });
  });

  it('bakes 5 directions and mirrors the other 3 (an iso screen flip swaps the tile axes)', () => {
    expect(BAKED_DIRS).toHaveLength(5);
    // Every one of the 8 screen directions resolves to a baked row.
    const seen = new Set(DIR8.map((d) => d.row));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4]);
    for (let d = 0; d < 8; d++) {
      const theta = d * 45;
      const { row, flip } = DIR8[d]!;
      // A mirrored direction θ must be the screen mirror (90° − θ) of the baked row's angle.
      const baked = BAKED_DIRS[row]!;
      const want = flip ? (((90 - theta) % 360) + 360) % 360 : theta;
      expect(baked, `direction ${theta}°`).toBe(want);
    }
  });

  it('maps the engine 16-direction facing to the nearest of 8', () => {
    expect(dir8Of(0)).toBe(0);
    expect(dir8Of(1)).toBe(1);
    expect(dir8Of(2)).toBe(1);
    expect(dir8Of(4)).toBe(2);
    expect(dir8Of(15)).toBe(0);
    expect(dir8Of(8)).toBe(4);
  });
});
