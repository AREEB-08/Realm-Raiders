import { scaleOutput } from '@realm/game-data';
import { MILLI } from './constants';
import { damageTroop } from './combat';
import { dist2 } from './math';
import type { BattleState } from './types';

/** Hidden traps: a ground troop in the trigger radius arms it; after the delay it hits the area once. */
export function updateTraps(state: BattleState) {
  for (const b of state.buildings) {
    if (!b.alive || !b.trapDef) continue;
    const def = b.trapDef;
    if (b.trapFireTick < 0) {
      const r2 = def.triggerRadius * def.triggerRadius;
      for (const t of state.troops) {
        if (!t.alive || t.flies) continue;
        if (dist2(t.x, t.y, b.cx, b.cy) <= r2) {
          b.trapFireTick = state.tick + def.delayTicks;
          break;
        }
      }
      if (b.trapFireTick < 0) continue;
    }
    if (state.tick < b.trapFireTick) continue;
    const dmg = scaleOutput(def.damage, b.level) * MILLI;
    const r2 = def.splash * def.splash;
    let hits = 0;
    for (const t of state.troops) {
      if (!t.alive || t.flies) continue;
      if (dist2(t.x, t.y, b.cx, b.cy) <= r2) {
        damageTroop(state, t, dmg);
        hits++;
      }
    }
    b.alive = false;
    b.hp = 0;
    state.events.push({ t: state.tick, k: 'trap', id: b.id, hits });
    state.fx.push({ k: 'trap', id: b.id });
  }
}
