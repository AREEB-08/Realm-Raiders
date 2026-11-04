import { GRID } from '@realm/game-data';

/** Pure layout of the forest around the island (no Phaser, so it is unit-tested). */

let seed = 0xf0e57;
const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);

export interface ForestTree {
  frame: string;
  /** Tile coordinates of the trunk base. */
  x: number;
  y: number;
  scale: number;
  flip: boolean;
}

/** The dirt path from the forest to the island's south-west edge, in tile coordinates. */
export const FOREST_PATH: readonly { x: number; y: number }[] = [
  { x: 13, y: 30.2 },
  { x: 13.4, y: 34 },
  { x: 11.6, y: 38 },
  { x: 12.4, y: 42 },
  { x: 10.8, y: 47 },
];

export function distToPath(x: number, y: number) {
  let best = Infinity;
  for (let i = 0; i + 1 < FOREST_PATH.length; i++) {
    const a = FOREST_PATH[i]!;
    const b = FOREST_PATH[i + 1]!;
    const vx = b.x - a.x;
    const vy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (y - a.y) * vy) / (vx * vx + vy * vy)));
    best = Math.min(best, Math.hypot(x - (a.x + vx * t), y - (a.y + vy * t)));
  }
  return best;
}

/**
 * Deterministic tree ring: a jittered grid around the island, denser further out, a clearing
 * along the path, smaller trees on the two sides that face the camera (so they never hide the
 * island's buildings).
 */
export function forestLayout(): ForestTree[] {
  seed = 0xf0e57;
  const out: ForestTree[] = [];
  const step = 1.85;
  const R = 17;
  for (let gy = -R; gy <= GRID + R; gy += step)
    for (let gx = -R; gx <= GRID + R; gx += step) {
      const x = gx + (rnd() - 0.5) * step * 0.9;
      const y = gy + (rnd() - 0.5) * step * 0.9;
      const front = x > GRID || y > GRID;
      const margin = front ? 2.6 : 1.4;
      const dx = Math.max(-margin - x, x - (GRID + margin), 0);
      const dy = Math.max(-margin - y, y - (GRID + margin), 0);
      const d = Math.max(dx, dy);
      if (d <= 0) continue;
      if (distToPath(x, y) < 1.7) continue;
      if (rnd() > Math.min(0.92, 0.35 + d * 0.12)) continue;
      const pineish = rnd() < 0.55;
      const shade = Math.floor(rnd() * 3);
      const near = d < 3;
      out.push({
        frame: rnd() < 0.05 ? `rock${Math.floor(rnd() * 2)}` : `${pineish ? 'pine' : 'leaf'}${shade}`,
        x,
        y,
        scale: (front && near ? 0.62 : near ? 0.82 : 0.95) + rnd() * 0.3,
        flip: rnd() < 0.5,
      });
    }
  // a few rocks by the path
  for (const p of FOREST_PATH.slice(1)) out.push({ frame: 'rock0', x: p.x + 1.9, y: p.y - 0.4, scale: 0.7, flip: false });
  return out;
}

