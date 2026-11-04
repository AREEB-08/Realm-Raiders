import { UNIT, WALL_PATH_PENALTY } from './constants';
import { dist2ToRect } from './math';
import type { BattleState, Building } from './types';

export const INF = 0x3fffffff;

/** Tile passability codes kept in `state.pass` (rebuilt only when a blocking building falls). */
export const FREE = 0;
export const WALL = 1;
export const SOLID = 2;

/** Neighbour order is fixed: it is the tie-break when two steps cost the same. */
const NDX = [0, 1, 0, -1, 1, 1, -1, -1] as const;
const NDY = [-1, 0, 1, 0, -1, 1, 1, -1] as const;
const NCOST = [10, 10, 10, 10, 14, 14, 14, 14] as const;

/**
 * Bucket queue (Dial's algorithm) for small integer edge costs. Pops in cost order and, within
 * one cost, in insertion order, so the search visits tiles identically on every runtime (the
 * stable-ordering rule of the reused path search's heap, at O(1) per push and pop).
 */
const MAX_EDGE = 14 + WALL_PATH_PENALTY;
class BucketQueue {
  private buckets: number[][] = Array.from({ length: MAX_EDGE + 1 }, () => []);
  private heads = new Int32Array(MAX_EDGE + 1);
  private cursor = 0;
  size = 0;
  lastCost = 0;
  reset() {
    for (const b of this.buckets) b.length = 0;
    this.heads.fill(0);
    this.cursor = 0;
    this.size = 0;
  }
  push(cost: number, tile: number) {
    this.buckets[cost % (MAX_EDGE + 1)]!.push(tile);
    this.size++;
  }
  pop(): number {
    const n = MAX_EDGE + 1;
    for (;;) {
      const slot = this.cursor % n;
      const bucket = this.buckets[slot]!;
      const head = this.heads[slot]!;
      if (head < bucket.length) {
        const tile = bucket[head]!;
        this.heads[slot] = head + 1;
        this.size--;
        this.lastCost = this.cursor;
        if (head + 1 === bucket.length) {
          bucket.length = 0;
          this.heads[slot] = 0;
        }
        return tile;
      }
      this.cursor++;
    }
  }
}

let sharedQueue: BucketQueue | null = null;

/** Rebuild the passability grid from the occupancy grid. */
export function fillPass(state: BattleState) {
  const pass = state.pass;
  for (let t = 0; t < pass.length; t++) {
    const i = state.occ[t]!;
    pass[t] = i < 0 ? FREE : state.buildings[i]!.wall ? WALL : SOLID;
  }
}

/** Diagonal steps may not cut a corner past anything standing (wall or building). */
function canStep(pass: Uint8Array, w: number, ax: number, ay: number, dx: number, dy: number): boolean {
  if (dx === 0 || dy === 0) return true;
  return pass[ay * w + ax + dx] === FREE && pass[(ay + dy) * w + ax] === FREE;
}

/**
 * Distance field towards every tile from which `target` is within `range`: a multi-source
 * search from the goal tiles outward (A* with a zero heuristic, run once per target and shared
 * by every troop that wants it). Entering a wall tile costs WALL_PATH_PENALTY on top of the
 * step, so walls are broken only when the way around is much longer or closed. Cached per
 * (target id, range, layout version) and dropped whenever a blocking building falls.
 */
export function fieldFor(state: BattleState, target: Building, range: number): Int32Array {
  const key = target.id * 100000 + range;
  const cached = state.fields.get(key);
  if (cached) return cached;
  const w = state.gridW;
  const h = state.gridH;
  const pass = state.pass;
  const dist = new Int32Array(w * h).fill(INF);
  const heap = (sharedQueue ??= new BucketQueue());
  heap.reset();
  // Goal tiles: free tiles whose centre is within range of the target's footprint. Widen if none.
  for (let extra = 0; extra <= 2000 && heap.size === 0; extra += 1000) {
    const reach = range + extra;
    const r2 = reach * reach;
    const pad = Math.ceil(reach / UNIT) + 1;
    const x0 = Math.max(0, target.x - pad);
    const x1 = Math.min(w - 1, target.x + target.size + pad);
    const y0 = Math.max(0, target.y - pad);
    const y1 = Math.min(h - 1, target.y + target.size + pad);
    for (let ty = y0; ty <= y1; ty++)
      for (let tx = x0; tx <= x1; tx++) {
        const t = ty * w + tx;
        if (pass[t] !== FREE) continue;
        const cx = tx * UNIT + UNIT / 2;
        const cy = ty * UNIT + UNIT / 2;
        if (dist2ToRect(cx, cy, target.x0, target.y0, target.x1, target.y1) <= r2) {
          dist[t] = 0;
          heap.push(0, t);
        }
      }
  }
  while (heap.size > 0) {
    const u = heap.pop();
    const d = heap.lastCost;
    if (d > dist[u]!) continue;
    const ux = u % w;
    const uy = (u - ux) / w;
    // Moving v -> u costs the step plus the wall penalty if u holds a live wall.
    const enter = pass[u] === WALL ? WALL_PATH_PENALTY : 0;
    for (let k = 0; k < 8; k++) {
      const dx = NDX[k]!;
      const dy = NDY[k]!;
      const vx = ux - dx;
      const vy = uy - dy;
      if (vx < 0 || vy < 0 || vx >= w || vy >= h) continue;
      const v = vy * w + vx;
      if (pass[v] === SOLID) continue;
      if (!canStep(pass, w, vx, vy, dx, dy)) continue;
      const nd = d + NCOST[k]! + enter;
      if (nd < dist[v]!) {
        dist[v] = nd;
        heap.push(nd, v);
      }
    }
  }
  state.fields.set(key, dist);
  return dist;
}

/**
 * The next tile for a ground unit standing on `tile`, following the field downhill.
 * Returns -1 when the unit is on a goal tile or has no route.
 */
export function nextTile(state: BattleState, field: Int32Array, tile: number): number {
  const here = field[tile]!;
  if (here === 0 || here >= INF) return -1;
  const w = state.gridW;
  const pass = state.pass;
  const tx = tile % w;
  const ty = (tile - tx) / w;
  let best = -1;
  let bestCost = INF;
  for (let k = 0; k < 8; k++) {
    const dx = NDX[k]!;
    const dy = NDY[k]!;
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx < 0 || ny < 0 || nx >= w || ny >= state.gridH) continue;
    const n = ny * w + nx;
    if (pass[n] === SOLID || !canStep(pass, w, tx, ty, dx, dy)) continue;
    const total = field[n]! + NCOST[k]! + (pass[n] === WALL ? WALL_PATH_PENALTY : 0);
    if (total < bestCost) {
      bestCost = total;
      best = n;
    }
  }
  return best;
}
