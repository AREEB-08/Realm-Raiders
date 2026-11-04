import { UNIT } from './constants';
import type { BattleState, Building } from './types';

/** Tile index of a unit position (clamped to the grid). */
export function tileOf(state: BattleState, x: number, y: number): number {
  let tx = Math.floor(x / UNIT);
  let ty = Math.floor(y / UNIT);
  if (tx < 0) tx = 0;
  else if (tx >= state.gridW) tx = state.gridW - 1;
  if (ty < 0) ty = 0;
  else if (ty >= state.gridH) ty = state.gridH - 1;
  return ty * state.gridW + tx;
}

/** True when a ground unit cannot stand on this tile (a live building or wall is on it). */
export function blocked(state: BattleState, tile: number): boolean {
  return state.pass[tile] !== 0;
}

/** The live wall on a tile, if any. */
export function wallAt(state: BattleState, tile: number): Building | null {
  const i = state.occ[tile]!;
  if (i < 0) return null;
  const b = state.buildings[i]!;
  return b.wall && b.alive ? b : null;
}

export function fillOccupancy(state: BattleState) {
  state.occ.fill(-1);
  for (let i = 0; i < state.buildings.length; i++) {
    const b = state.buildings[i]!;
    if (!b.alive || b.trap) continue;
    for (let y = b.y; y < b.y + b.size; y++)
      for (let x = b.x; x < b.x + b.size; x++) state.occ[y * state.gridW + x] = i;
  }
}

export function clearOccupancy(state: BattleState, b: Building) {
  for (let y = b.y; y < b.y + b.size; y++)
    for (let x = b.x; x < b.x + b.size; x++) {
      const t = y * state.gridW + x;
      if (state.buildings[state.occ[t]!] === b) {
        state.occ[t] = -1;
        state.pass[t] = 0;
      }
    }
}

/**
 * The no-deploy zone is fixed at battle start: every non-trap footprint grown by one tile
 * (§10.6: deploy on the shoreline ring, or at least one tile away from any footprint).
 */
export function fillNoDeploy(state: BattleState) {
  state.noDeploy.fill(0);
  for (const b of state.buildings) {
    if (b.trap) continue;
    for (let y = b.y - 1; y < b.y + b.size + 1; y++)
      for (let x = b.x - 1; x < b.x + b.size + 1; x++) {
        if (x < 0 || y < 0 || x >= state.gridW || y >= state.gridH) continue;
        state.noDeploy[y * state.gridW + x] = 1;
      }
  }
}

/** Whether a deploy at (x10, y10) — tiles × 10 — is allowed on this base. */
export function deployAllowed(
  noDeploy: Uint8Array,
  gridW: number,
  gridH: number,
  x10: number,
  y10: number,
): boolean {
  if (!Number.isInteger(x10) || !Number.isInteger(y10)) return false;
  if (x10 < 0 || y10 < 0 || x10 >= gridW * 10 || y10 >= gridH * 10) return false;
  const tx = Math.floor(x10 / 10);
  const ty = Math.floor(y10 / 10);
  return noDeploy[ty * gridW + tx] === 0;
}
