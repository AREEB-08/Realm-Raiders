import { describe, expect, it } from 'vitest';
import { GRID } from '@realm/game-data';
import { FOREST_PATH, distToPath, forestLayout } from '../src/game/forest-layout';

describe('forest around the island (F2)', () => {
  const trees = forestLayout();

  it('is deterministic (the same forest on every device)', () => {
    expect(forestLayout()).toEqual(trees);
  });

  it('is dense but bounded (one atlas, a few hundred batched sprites)', () => {
    expect(trees.length).toBeGreaterThan(250);
    expect(trees.length).toBeLessThan(900);
    const kinds = new Set(trees.map((t) => t.frame.replace(/\d$/, '')));
    expect([...kinds].sort()).toEqual(['leaf', 'pine', 'rock']);
    const shades = new Set(trees.filter((t) => t.frame.startsWith('pine')).map((t) => t.frame));
    expect(shades.size).toBe(3);
  });

  it('never grows on the island or on the path', () => {
    for (const t of trees) {
      const onIsland = t.x > -1 && t.y > -1 && t.x < GRID + 1 && t.y < GRID + 1;
      expect(onIsland, `${t.frame} at ${t.x.toFixed(1)},${t.y.toFixed(1)}`).toBe(false);
      if (!t.frame.startsWith('rock')) expect(distToPath(t.x, t.y)).toBeGreaterThanOrEqual(1.7);
    }
  });

  it('the path starts at the island edge and leads out into the forest', () => {
    expect(FOREST_PATH[0]!.y).toBeCloseTo(GRID, 0);
    expect(FOREST_PATH[FOREST_PATH.length - 1]!.y).toBeGreaterThan(GRID + 12);
  });
});
