import { damageBuilding, damageTroop, troopSplash } from './combat';
import { dist2 } from './math';
import type { BattleState, Projectile } from './types';

/**
 * Impact queue (ported from the reused projectile rules, with flight time in whole ticks).
 * Homing shots hit their target if it still stands; splash shots hit everything in the radius.
 */
export function landProjectiles(state: BattleState) {
  if (state.projectiles.length === 0) return;
  const keep: Projectile[] = [];
  for (const p of state.projectiles) {
    if (p.impactTick > state.tick) {
      keep.push(p);
      continue;
    }
    if (p.from === 'troop') {
      const owner = state.troops[p.ownerId] ?? null;
      if (p.targetId < 0) {
        // v2 fanned fireball: no target of its own, it splashes where it lands.
        troopSplash(state, p.x, p.y, p.splash, p.damage, owner, null);
        state.fx.push({ k: 'impact', x: p.x, y: p.y, splash: p.splash, kind: p.ownerType });
        continue;
      }
      const b = state.buildings[p.targetId];
      if (b && b.alive) {
        damageBuilding(state, b, p.damage, owner);
        if (p.splash > 0) troopSplash(state, b.cx, b.cy, p.splash, p.damage, owner, b);
      }
      state.fx.push({ k: 'impact', x: p.x, y: p.y, splash: p.splash, kind: p.ownerType });
      continue;
    }
    if (p.homing) {
      const t = state.troops[p.targetId];
      if (t && t.alive) {
        damageTroop(state, t, p.damage);
        state.fx.push({ k: 'impact', x: t.x, y: t.y, splash: 0, kind: p.ownerType });
      }
      continue;
    }
    const r2 = p.splash * p.splash;
    for (const t of state.troops) {
      if (!t.alive) continue;
      if (t.flies ? !p.hitsAir : !p.hitsGround) continue;
      if (dist2(t.x, t.y, p.x, p.y) <= r2) damageTroop(state, t, p.damage);
    }
    state.fx.push({ k: 'impact', x: p.x, y: p.y, splash: p.splash, kind: p.ownerType });
  }
  state.projectiles = keep;
}
