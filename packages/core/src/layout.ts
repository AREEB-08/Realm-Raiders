import {
  BUILDINGS,
  BUILD_MAX,
  BUILD_MIN,
  GRID,
  isBuildingId,
  limitFor,
  maxLevelFor,
  type BuildingId,
  type Layout,
  type LayoutBuilding,
} from '@realm/game-data';
import type { LayoutAnalysis, LayoutMove } from '@realm/shared';

export const citadelLevelOf = (layout: Layout) =>
  layout.buildings.find((b) => b.type === 'citadel')?.level ?? 1;

export function footprint(b: { type: BuildingId; x: number; y: number }) {
  const s = BUILDINGS[b.type].size;
  return { x0: b.x, y0: b.y, x1: b.x + s, y1: b.y + s, size: s };
}

/** Grid of building indexes (-1 free), optionally skipping one building (for drag checks). */
export function occupancy(layout: Layout, skipId?: string): Int16Array {
  const occ = new Int16Array(GRID * GRID).fill(-1);
  layout.buildings.forEach((b, i) => {
    if (b.id === skipId) return;
    const f = footprint(b);
    for (let y = f.y0; y < f.y1; y++)
      for (let x = f.x0; x < f.x1; x++) if (x >= 0 && y >= 0 && x < GRID && y < GRID) occ[y * GRID + x] = i;
  });
  return occ;
}

/** Can a building of `type` stand at (x, y) given the occupancy? */
export function canPlace(occ: Int16Array, type: BuildingId, x: number, y: number): boolean {
  const s = BUILDINGS[type].size;
  if (x < BUILD_MIN || y < BUILD_MIN || x + s > BUILD_MAX || y + s > BUILD_MAX) return false;
  for (let yy = y; yy < y + s; yy++) for (let xx = x; xx < x + s; xx++) if (occ[yy * GRID + xx]! >= 0) return false;
  return true;
}

/** Full rule check of a layout: types, bounds, overlaps, citadel count, count limits, level caps. */
export function layoutErrors(layout: Layout): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const counts = new Map<string, number>();
  const citadels = layout.buildings.filter((b) => b.type === 'citadel');
  if (citadels.length !== 1) errors.push('A holdfast needs exactly one Citadel.');
  const cl = citadels[0]?.level ?? 1;
  const occ = new Int16Array(GRID * GRID).fill(-1);
  layout.buildings.forEach((b, i) => {
    if (!isBuildingId(b.type)) {
      errors.push(`Unknown building "${b.type}".`);
      return;
    }
    if (ids.has(b.id)) errors.push(`Duplicate building id ${b.id}.`);
    ids.add(b.id);
    counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
    const def = BUILDINGS[b.type];
    if (b.level < 1 || b.level > maxLevelFor(b.type, cl)) errors.push(`${def.name} level ${b.level} is above its cap.`);
    const f = footprint(b);
    if (f.x0 < BUILD_MIN || f.y0 < BUILD_MIN || f.x1 > BUILD_MAX || f.y1 > BUILD_MAX) {
      errors.push(`${def.name} is off the buildable ground.`);
      return;
    }
    for (let y = f.y0; y < f.y1; y++)
      for (let x = f.x0; x < f.x1; x++) {
        const t = y * GRID + x;
        if (occ[t]! >= 0) {
          errors.push(`${def.name} overlaps ${BUILDINGS[layout.buildings[occ[t]!]!.type].name}.`);
          return;
        }
        occ[t] = i;
      }
  });
  for (const [type, n] of counts) {
    const lim = limitFor(type as BuildingId, cl);
    if (n > lim) errors.push(`Too many ${BUILDINGS[type as BuildingId].name} (${n}/${lim}) for Citadel ${cl}.`);
  }
  return [...new Set(errors)];
}

/** A moved layout must keep the same buildings (ids, types, levels): only positions change. */
export function sameBuildings(a: Layout, b: Layout): boolean {
  if (a.buildings.length !== b.buildings.length) return false;
  const key = (x: LayoutBuilding) => `${x.id}|${x.type}|${x.level}`;
  const sa = a.buildings.map(key).sort();
  const sb = b.buildings.map(key).sort();
  return sa.every((v, i) => v === sb[i]);
}

export function applyMoves(layout: Layout, moves: LayoutMove[]): Layout {
  const out = structuredClone(layout);
  for (const m of moves) {
    const b = out.buildings.find((x) => x.id === m.buildingId);
    if (b) {
      b.x = m.x;
      b.y = m.y;
    }
  }
  return out;
}

// ------------------------------------------------------------- analysis ---

const QUADS = ['north', 'east', 'south', 'west'] as const;
type Quad = (typeof QUADS)[number];

function centreOf(b: LayoutBuilding) {
  const s = BUILDINGS[b.type].size;
  return { x: b.x + s / 2, y: b.y + s / 2 };
}

/** Quadrant of a point relative to the base centre (north = small y, east = large x). */
function quadOf(x: number, y: number, cx: number, cy: number): Quad {
  const dx = x - cx;
  const dy = y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

/**
 * Static base analysis for the Architect (§14.2): how much of each quadrant's built ground is
 * inside some defence's range, how many defences cover the Citadel, and which storages can be
 * reached from the shore without crossing a wall.
 */
export function analyzeLayout(layout: Layout): LayoutAnalysis {
  const citadel = layout.buildings.find((b) => b.type === 'citadel');
  const c = citadel ? centreOf(citadel) : { x: GRID / 2, y: GRID / 2 };
  const defences = layout.buildings.filter((b) => BUILDINGS[b.type].defence);
  const covered = (x: number, y: number) =>
    defences.filter((d) => {
      const dc = centreOf(d);
      const r = BUILDINGS[d.type].defence!.range / 1000;
      const min = BUILDINGS[d.type].defence!.minRange / 1000;
      const dist2 = (dc.x - x) ** 2 + (dc.y - y) ** 2;
      return dist2 <= r * r && dist2 >= min * min;
    }).length;
  // Quadrant coverage over the tiles that hold non-wall buildings plus a 1-tile apron.
  const occ = occupancy(layout);
  const tally: Record<Quad, { all: number; cov: number }> = {
    north: { all: 0, cov: 0 },
    east: { all: 0, cov: 0 },
    south: { all: 0, cov: 0 },
    west: { all: 0, cov: 0 },
  };
  for (let y = BUILD_MIN; y < BUILD_MAX; y++)
    for (let x = BUILD_MIN; x < BUILD_MAX; x++) {
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1 && !near; dx++) {
          const i = occ[(y + dy) * GRID + (x + dx)];
          if (i !== undefined && i >= 0 && !['wall', 'caltrops'].includes(layout.buildings[i]!.type)) near = true;
        }
      if (!near) continue;
      const q = quadOf(x + 0.5, y + 0.5, c.x, c.y);
      tally[q].all++;
      if (covered(x + 0.5, y + 0.5) > 0) tally[q].cov++;
    }
  const citadelCoverage = citadel ? covered(c.x, c.y) : 0;
  // Exposed storages: reachable from the shoreline by 4-way flood fill that walls stop.
  const reach = new Uint8Array(GRID * GRID);
  const queue: number[] = [];
  for (let i = 0; i < GRID; i++)
    for (const t of [i, (GRID - 1) * GRID + i, i * GRID, i * GRID + GRID - 1])
      if (!reach[t] && occ[t]! < 0) {
        reach[t] = 1;
        queue.push(t);
      }
  while (queue.length) {
    const t = queue.shift()!;
    const x = t % GRID;
    const y = (t - x) / GRID;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= GRID || ny >= GRID) continue;
      const n = ny * GRID + nx;
      if (reach[n]) continue;
      const i = occ[n]!;
      if (i >= 0 && layout.buildings[i]!.type === 'wall') continue;
      reach[n] = 1;
      if (i < 0 || layout.buildings[i]!.type === 'caltrops') queue.push(n);
    }
  }
  const exposedStorages = layout.buildings
    .filter((b) => BUILDINGS[b.type].category === 'storage' || b.type === 'citadel')
    .filter((b) => {
      const f = footprint(b);
      for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) if (reach[y * GRID + x]) return true;
      return false;
    })
    .map((b) => b.id);
  return {
    quadrants: QUADS.map((name) => ({
      name,
      coverage: tally[name].all ? Math.round((tally[name].cov / tally[name].all) * 100) : 100,
    })),
    citadelCoverage,
    coveredCitadelPct: defences.length ? Math.round((citadelCoverage / defences.length) * 100) : 0,
    exposedStorages,
    defenceCount: defences.length,
    wallCount: layout.buildings.filter((b) => b.type === 'wall').length,
  };
}

function score(a: LayoutAnalysis) {
  const minQuad = Math.min(...a.quadrants.map((q) => q.coverage));
  const avgQuad = a.quadrants.reduce((n, q) => n + q.coverage, 0) / 4;
  return a.coveredCitadelPct * 2 + minQuad * 1.5 + avgQuad - a.exposedStorages.length * 25;
}

/**
 * The Architect's rule-based patch (§14.2 fallback): nudge the defence that matters least
 * towards the weakest quadrant, and pull an exposed storage inward, keeping only moves that
 * raise the score. At most `maxMoves` moves, all valid placements.
 */
export function heuristicPatch(layout: Layout, maxMoves = 3): { moves: LayoutMove[]; rationale: string } | null {
  let current = structuredClone(layout);
  let best = score(analyzeLayout(current));
  const moves: LayoutMove[] = [];
  const reasons: string[] = [];
  const citadel = current.buildings.find((b) => b.type === 'citadel');
  const c = citadel ? centreOf(citadel) : { x: 15, y: 15 };
  const dirs: Record<Quad, [number, number]> = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };

  for (let round = 0; round < maxMoves; round++) {
    const analysis = analyzeLayout(current);
    const weakest = [...analysis.quadrants].sort((a, b) => a.coverage - b.coverage)[0]!;
    const candidates = current.buildings.filter(
      (b) => BUILDINGS[b.type].defence || (analysis.exposedStorages.includes(b.id) && b.type !== 'citadel'),
    );
    let pick: { b: LayoutBuilding; x: number; y: number; s: number; why: string } | null = null;
    for (const b of candidates) {
      const isDef = !!BUILDINGS[b.type].defence;
      const [dx, dy] = isDef ? dirs[weakest.name] : [Math.sign(c.x - centreOf(b).x), Math.sign(c.y - centreOf(b).y)];
      const occ = occupancy(current, b.id);
      for (let step = 1; step <= 3; step++) {
        const nx = b.x + dx * step;
        const ny = b.y + dy * step;
        if (!canPlace(occ, b.type, nx, ny)) continue;
        const trial = applyMoves(current, [{ buildingId: b.id, x: nx, y: ny }]);
        const s = score(analyzeLayout(trial));
        if (s > best + 0.5 && (!pick || s > pick.s)) {
          pick = {
            b,
            x: nx,
            y: ny,
            s,
            why: isDef
              ? `move ${BUILDINGS[b.type].name} ${step} step${step > 1 ? 's' : ''} ${weakest.name} to cover the ${weakest.name} flank`
              : `pull ${BUILDINGS[b.type].name} inward`,
          };
        }
      }
    }
    if (!pick) break;
    moves.push({ buildingId: pick.b.id, x: pick.x, y: pick.y });
    reasons.push(pick.why);
    current = applyMoves(current, [{ buildingId: pick.b.id, x: pick.x, y: pick.y }]);
    best = pick.s;
  }
  if (!moves.length) return null;
  return { moves, rationale: `${reasons.join('; ')}.`.replace(/^./, (s) => s.toUpperCase()) };
}

/** Validate a proposed patch: ≤ 5 moves, known buildings, the result must be a valid layout. */
export function validatePatch(layout: Layout, moves: LayoutMove[]): string | null {
  if (moves.length > 5) return 'at most 5 moves';
  for (const m of moves) if (!layout.buildings.some((b) => b.id === m.buildingId)) return `unknown building ${m.buildingId}`;
  const errors = layoutErrors(applyMoves(layout, moves));
  return errors.length ? errors[0]! : null;
}
