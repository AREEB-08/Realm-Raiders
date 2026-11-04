import { GRID } from '@realm/game-data';

/**
 * Isometric projection (adapted from the reused scene's `WORLD`/`iso`/`isoInto`/`uniso`):
 * tiles are 64×32 px diamonds; x grows to the lower right, y to the lower left.
 */
export const TW = 64;
export const TH = 32;
const MARGIN_X = 520;
const MARGIN_TOP = 360;
const MARGIN_BOTTOM = 420;

export const WORLD = {
  width: GRID * TW + MARGIN_X * 2,
  height: GRID * TH + MARGIN_TOP + MARGIN_BOTTOM,
  ox: MARGIN_X + (GRID * TW) / 2,
  oy: MARGIN_TOP,
};

export const iso = (x: number, y: number) => ({ x: WORLD.ox + (x - y) * (TW / 2), y: WORLD.oy + (x + y) * (TH / 2) });

/** Non-allocating `iso` for hot loops. */
export function isoInto<T extends { x: number; y: number }>(out: T, x: number, y: number): T {
  out.x = WORLD.ox + (x - y) * (TW / 2);
  out.y = WORLD.oy + (x + y) * (TH / 2);
  return out;
}

/** Screen (world px) → fractional tile coordinates. */
export const uniso = (sx: number, sy: number) => {
  const a = (sx - WORLD.ox) / (TW / 2);
  const b = (sy - WORLD.oy) / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
};

/** Footprint centre and the depth key (its bottom vertex) of a building at (x, y) of size s. */
export function footprintScreen(x: number, y: number, s: number) {
  const c = iso(x + s / 2, y + s / 2);
  return { cx: c.x, cy: c.y, depth: iso(x + s, y + s).y };
}

export const inGrid = (x: number, y: number) => x >= 0 && y >= 0 && x < GRID && y < GRID;
