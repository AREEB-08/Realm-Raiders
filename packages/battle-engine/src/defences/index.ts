import { scaleOutput } from '@realm/game-data';
import { MILLI } from '../constants';
import { damageTroop } from '../combat';
import { idiv } from '../math';
import { defenceTarget } from '../targeting';
import type { BattleState, Building } from '../types';
import { obeliskTick } from './obelisk';
import { stonethrowerAim } from './stonethrower';

/** Defence loop (§13.3 step 4), in building-id order: sticky nearest target, air/ground filter. */
export function updateDefences(state: BattleState) {
  for (const b of state.buildings) {
    if (!b.alive || !b.defence) continue;
    updateDefence(state, b);
  }
}

function updateDefence(state: BattleState, b: Building) {
  const def = b.defence!;
  if (b.cooldown > 0) b.cooldown--;
  const target = defenceTarget(state, b);
  if (!target) {
    b.targetId = -1;
    b.lockTicks = 0;
    return;
  }
  if (target.id !== b.targetId) {
    b.targetId = target.id;
    b.lockTicks = 0;
  }
  if (def.rampDps) {
    const { dmg, stage } = obeliskTick(b);
    b.lockTicks++;
    damageTroop(state, target, dmg);
    if (state.tick % 4 === 0) state.fx.push({ k: 'beam', from: b.id, to: target.id, stage });
    return;
  }
  if (b.cooldown > 0) return;
  b.cooldown = def.intervalTicks;
  const base = scaleOutput(def.damage, b.level) * MILLI;
  const dmg = idiv(base * state.rng.variance(), 1000);
  const aim = def.splash > 0 ? stonethrowerAim(b, target) : { x: target.x, y: target.y, homing: true };
  state.projectiles.push({
    id: state.nextId++,
    from: 'defence',
    ownerId: b.id,
    ownerType: b.type,
    fireTick: state.tick,
    impactTick: state.tick + def.flightTicks,
    damage: dmg,
    targetId: aim.homing ? target.id : -1,
    sx: b.cx,
    sy: b.cy,
    x: aim.x,
    y: aim.y,
    splash: def.splash,
    hitsAir: def.hitsAir,
    hitsGround: def.hitsGround,
    homing: aim.homing,
    resourceBonusPct: 100,
  });
  state.fx.push({ k: 'shot', pid: state.nextId - 1 });
}
