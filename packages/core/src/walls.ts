import { BUILDINGS, BUILD_MAX, BUILD_MIN, GRID, buildCost, limitFor, type Layout, type ResourceId } from '@realm/game-data';
import { canPlace, citadelLevelOf, occupancy } from './layout';

/** Why one tile of a wall line can (or can't) take a wall. */
export type WallTileState = 'ok' | 'outside' | 'occupied' | 'limit' | 'short';

export interface WallTile {
  x: number;
  y: number;
  state: WallTileState;
}

export interface WallPlan {
  tiles: WallTile[];
  /** The tiles that will get a wall, in line order. */
  placeable: { x: number; y: number }[];
  /** Total price of the placeable walls. */
  cost: number;
  resource: ResourceId;
  /** Walls already standing and the Citadel's limit. */
  have: number;
  limit: number;
  /** The first problem on the line, in player words (null when every tile is fine). */
  problem: string | null;
}

/** Longest line one drag may draw. */
export const WALL_LINE_MAX = 30;

const RESOURCE_NAMES: Record<ResourceId, string> = { gold: 'Gold', timber: 'Timber', ember: 'Ember' };

/** Player-facing reasons (exact copy, spec §4 "Build / walls"). */
export function wallProblem(state: Exclude<WallTileState, 'ok'>, plan: Pick<WallPlan, 'resource' | 'limit'>, citadel = 1) {
  switch (state) {
    case 'outside':
      return 'Walls must be inside your island';
    case 'occupied':
      return 'Something is already here';
    case 'short':
      return `Not enough ${RESOURCE_NAMES[plan.resource]}`;
    case 'limit':
      return `Wall limit reached (${plan.limit} for Citadel ${citadel}). Raise the Citadel for more.`;
  }
}

/**
 * Check a wall line tile by tile against the island, the wall limit and the purse, in order.
 * The same function draws the ghost preview on the phone and guards `POST /base/walls`, so what
 * the player confirms is exactly what is placed and charged.
 */
export function planWalls(layout: Layout, purse: Partial<Record<ResourceId, number>>, line: { x: number; y: number }[]): WallPlan {
  const citadel = citadelLevelOf(layout);
  const limit = limitFor('wall', citadel);
  const have = layout.buildings.filter((b) => b.type === 'wall').length;
  const price = buildCost('wall', 1);
  const occ = occupancy(layout);
  const seen = new Set<number>();
  const tiles: WallTile[] = [];
  const placeable: { x: number; y: number }[] = [];
  let budget = purse[price.resource] ?? 0;
  for (const raw of line.slice(0, WALL_LINE_MAX)) {
    const x = Math.floor(raw.x);
    const y = Math.floor(raw.y);
    const inside = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < GRID && y < GRID;
    const key = inside ? y * GRID + x : -1;
    if (key >= 0 && seen.has(key)) continue;
    if (key >= 0) seen.add(key);
    let state: WallTileState = 'ok';
    if (!inside || x < BUILD_MIN || y < BUILD_MIN || x + 1 > BUILD_MAX || y + 1 > BUILD_MAX) state = 'outside';
    else if (!canPlace(occ, 'wall', x, y)) state = 'occupied';
    else if (have + placeable.length >= limit) state = 'limit';
    else if (budget < price.amount) state = 'short';
    tiles.push({ x, y, state });
    if (state !== 'ok') continue;
    placeable.push({ x, y });
    budget -= price.amount;
    occ[key] = 0;
  }
  const base = { resource: price.resource, limit };
  const firstBad = tiles.find((t) => t.state !== 'ok');
  return {
    tiles,
    placeable,
    cost: placeable.length * price.amount,
    resource: price.resource,
    have,
    limit,
    problem: firstBad ? wallProblem(firstBad.state as Exclude<WallTileState, 'ok'>, base, citadel) : null,
  };
}

/** Display name of the wall (for copy such as "Place 6 walls · 300 Gold"). */
export const wallName = () => BUILDINGS.wall.name;
export const resourceName = (r: ResourceId) => RESOURCE_NAMES[r];
