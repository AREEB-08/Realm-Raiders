import { dist2, dist2ToRect } from './math';
import type { BattleState, Building, Troop } from './types';

/**
 * Pick a troop's target (§13.3 step 2). The preference filters candidates (walls first for
 * sappers, stores first for v1 ravagers, defences first for v2 Stone Giants); the nearest by
 * squared distance to the footprint wins.
 * On a troop's very first pick, an exact tie is settled by the battle RNG; later ties go to the
 * lowest id (ported from the reused nearest-first scan with id tie-break).
 */
export function chooseTarget(state: BattleState, troop: Troop): Building | null {
  const pref = troop.def.targets;
  let pool: Pool = pref === 'walls' ? 'walls' : pref === 'resources' ? 'resources' : pref === 'defences' ? 'defences' : 'any';
  for (let attempt = 0; attempt < 2; attempt++) {
    const found = scan(state, troop, pool);
    if (found) return found;
    if (pool === 'any') break;
    pool = 'any';
  }
  return null;
}

type Pool = 'walls' | 'resources' | 'defences' | 'any';

function scan(state: BattleState, troop: Troop, pool: Pool) {
  let best = Infinity;
  let ties: Building[] = [];
  for (const b of state.buildings) {
    if (!b.alive || b.trap) continue;
    if (pool === 'walls' ? !b.wall : b.wall) continue;
    if (pool === 'resources' && !b.resource) continue;
    // v2 Stone Giant: defences first (towers, throwers, obelisks, ballistas).
    if (pool === 'defences' && !b.defence) continue;
    const d = dist2ToRect(troop.x, troop.y, b.x0, b.y0, b.x1, b.y1);
    if (d < best) {
      best = d;
      ties = [b];
    } else if (d === best) ties.push(b);
  }
  if (ties.length === 0) return null;
  if (ties.length === 1 || troop.everTargeted) return ties[0]!;
  return ties[state.rng.below(ties.length)]!;
}

/** Defence target: sticky while valid, else the nearest eligible troop (ties: lowest id). */
export function defenceTarget(state: BattleState, b: Building): Troop | null {
  if (b.targetId >= 0) {
    const current = state.troops[b.targetId];
    if (current && eligibleDistance(b, current) >= 0) return current;
  }
  let best: Troop | null = null;
  let bestD = Infinity;
  for (const t of state.troops) {
    const d = eligibleDistance(b, t);
    if (d >= 0 && d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Squared distance if the defence may shoot this troop now, else -1. */
function eligibleDistance(b: Building, t: Troop): number {
  if (!t.alive) return -1;
  const def = b.defence!;
  if (t.flies ? !def.hitsAir : !def.hitsGround) return -1;
  const d = dist2(b.cx, b.cy, t.x, t.y);
  return d <= def.range * def.range && d >= def.minRange * def.minRange ? d : -1;
}
