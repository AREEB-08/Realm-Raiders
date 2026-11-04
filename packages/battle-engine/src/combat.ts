import { RALLY } from '@realm/game-data';
import { SEPARATION, UNIT } from './constants';
import { blocked, tileOf, wallAt } from './grid';
import { DIR16, dirIndex, dist2, dist2ToRect, idiv, isqrt, stepToward } from './math';
import { fieldFor, INF, nextTile } from './pathfinding';
import { chooseTarget } from './targeting';
import type { BattleState, Building, Troop } from './types';

const tmp = { x: 0, y: 0 };

export function damageBuilding(state: BattleState, b: Building, dmg: number, by: Troop | null) {
  if (!b.alive || dmg <= 0) return;
  const dealt = Math.min(dmg, b.hp);
  b.hp -= dmg;
  b.hitTick = state.tick;
  if (by) state.damageBy[by.kindIdx]! += dealt;
  state.fx.push({ k: 'hitB', id: b.id, dmg });
}

export function damageTroop(state: BattleState, t: Troop, dmg: number) {
  if (!t.alive || dmg <= 0) return;
  t.hp -= dmg;
  t.hitTick = state.tick;
  state.fx.push({ k: 'hitT', id: t.id, dmg });
}

/** Rally aura: +25 % damage near a living General while the Rally lasts. */
function rallied(state: BattleState, t: Troop): boolean {
  if (state.tick >= state.rallyUntil || state.generalId < 0) return false;
  const g = state.troops[state.generalId]!;
  if (!g.alive) return false;
  return dist2(g.x, g.y, t.x, t.y) <= RALLY.radius * RALLY.radius;
}

function inRange(t: Troop, b: Building): boolean {
  return dist2ToRect(t.x, t.y, b.x0, b.y0, b.x1, b.y1) <= t.range * t.range;
}

/** One hit's damage (milli-HP) from troop `t` against building `b`, with variance and bonuses. */
function hitDamage(state: BattleState, t: Troop, b: Building): number {
  let dmg = idiv(t.dmgPerHit * state.rng.variance(), 1000);
  if (rallied(state, t)) dmg = idiv(dmg * RALLY.bonusPct, 100);
  if (t.def.targets === 'resources' && b.resource) dmg = idiv(dmg * t.def.preferredBonusPct, 100);
  // v2 Stone Giant: fists made for smashing defences (no v1 troop targets defences).
  if (t.def.targets === 'defences' && b.defence) dmg = idiv(dmg * t.def.preferredBonusPct, 100);
  return dmg;
}

/**
 * v2 Fire Dragon breath (instant): the target, plus every building in a cone towards it
 * (half-angle from `cone.tan1000`) that the fire reaches — `cone.reach` past the target's far
 * edge, counting any building it touches. Integer test, no angles: forward f = dragon→target
 * centre; another centre v is inside when v·f > 0, |v×f|·1000 ≤ (v·f)·tan1000 and
 * |v| ≤ |f| + target half-size + reach + its own half-size. Magnitudes stay below 2^50.
 */
function breath(state: BattleState, t: Troop, b: Building, dmg: number) {
  const cone = t.def.cone!;
  const fx = b.cx - t.x;
  const fy = b.cy - t.y;
  const flen = isqrt(fx * fx + fy * fy);
  const reach = flen + b.size * 500 + cone.reach;
  damageBuilding(state, b, dmg, t);
  for (const o of state.buildings) {
    if (o === b || !o.alive || o.trap) continue;
    const vx = o.cx - t.x;
    const vy = o.cy - t.y;
    const dot = vx * fx + vy * fy;
    if (dot <= 0) continue;
    const r = reach + o.size * 500;
    if (vx * vx + vy * vy > r * r) continue;
    const cross = vx * fy - vy * fx;
    if ((cross < 0 ? -cross : cross) * 1000 > dot * cone.tan1000) continue;
    damageBuilding(state, o, dmg, t);
  }
  state.fx.push({ k: 'breath', id: t.id, x: b.cx, y: b.cy });
}

/**
 * v2 Ember Mage volley: one fireball at the target and the rest fanned sideways (perpendicular
 * to the throw, `fanSpread` apart), each splashing where it lands.
 */
function volley(state: BattleState, t: Troop, b: Building, dmg: number) {
  const n = t.def.volley!;
  const spread = t.def.fanSpread ?? 0;
  const dx = b.cx - t.x;
  const dy = b.cy - t.y;
  const len = isqrt(dx * dx + dy * dy) || 1;
  const px = idiv(-dy * spread, len);
  const py = idiv(dx * spread, len);
  for (let i = 0; i < n; i++) {
    // 0 → the target itself, then ±1, ±2 … fan steps alternating left and right.
    const k = i === 0 ? 0 : i % 2 === 1 ? (i + 1) / 2 : -(i / 2);
    state.projectiles.push({
      id: state.nextId++,
      from: 'troop',
      ownerId: t.id,
      ownerType: t.kind,
      fireTick: state.tick,
      impactTick: state.tick + t.def.flightTicks,
      damage: dmg,
      targetId: k === 0 ? b.id : -1,
      sx: t.x,
      sy: t.y,
      x: b.cx + px * k,
      y: b.cy + py * k,
      splash: t.def.splash,
      hitsAir: false,
      hitsGround: true,
      homing: k === 0,
      resourceBonusPct: 100,
    });
    state.fx.push({ k: 'shot', pid: state.nextId - 1 });
  }
}

function attack(state: BattleState, t: Troop, b: Building) {
  t.facing = dirIndex(b.cx - t.x, b.cy - t.y);
  t.attackTick = state.tick;
  t.cooldown = t.def.attackTicks;
  const dmg = hitDamage(state, t, b);
  if (t.def.cone) return breath(state, t, b, dmg);
  if (t.def.volley && t.def.volley > 1) return volley(state, t, b, dmg);
  if (t.def.flightTicks > 0) {
    state.projectiles.push({
      id: state.nextId++,
      from: 'troop',
      ownerId: t.id,
      ownerType: t.kind,
      fireTick: state.tick,
      impactTick: state.tick + t.def.flightTicks,
      damage: dmg,
      targetId: b.id,
      sx: t.x,
      sy: t.y,
      x: b.cx,
      y: b.cy,
      splash: t.def.splash,
      hitsAir: false,
      hitsGround: true,
      homing: true,
      resourceBonusPct: 100,
    });
    state.fx.push({ k: 'shot', pid: state.nextId - 1 });
    return;
  }
  damageBuilding(state, b, dmg, t);
  if (state.v >= 2 && !t.def.detonates) state.fx.push(t.def.slam ? { k: 'slam', id: t.id, x: b.cx, y: b.cy } : { k: 'swing', id: t.id });
  if (t.def.detonates) {
    // Sapper blast: the target plus every wall around it, then the sapper is spent.
    if (t.def.splash > 0) {
      const r2 = t.def.splash * t.def.splash;
      for (const w of state.buildings) {
        if (w === b || !w.alive || !w.wall) continue;
        if (dist2(w.cx, w.cy, b.cx, b.cy) <= r2) damageBuilding(state, w, dmg, t);
      }
    }
    state.fx.push({ k: 'boom', x: b.cx, y: b.cy });
    t.hp = 0;
  }
}

/** Splash from a troop projectile (drake fire): every building whose footprint is in the radius. */
export function troopSplash(state: BattleState, x: number, y: number, r: number, dmg: number, by: Troop | null, except: Building | null) {
  const r2 = r * r;
  for (const b of state.buildings) {
    if (b === except || !b.alive || b.trap) continue;
    if (dist2ToRect(x, y, b.x0, b.y0, b.x1, b.y1) <= r2) damageBuilding(state, b, dmg, by);
  }
}

/**
 * Advance one troop (§13.3 step 4): attack whatever it is engaged with when in range, else walk.
 * Ground units follow the cached distance field; a live wall on the next tile becomes the thing
 * to hit (the ported breach behaviour). Fliers go straight.
 */
export function updateTroop(state: BattleState, t: Troop) {
  if (!t.alive) return;
  if (t.cooldown > 0) t.cooldown--;
  t.moving = false;
  let target = t.targetId >= 0 ? state.buildings[t.targetId]! : null;
  if (!target || !target.alive) {
    t.targetId = -1;
    const next = chooseTarget(state, t);
    t.everTargeted = true;
    if (!next) {
      t.engageId = -1;
      return;
    }
    t.targetId = next.id;
    target = next;
  }
  if (inRange(t, target)) {
    t.engageId = target.id;
    if (t.cooldown === 0) attack(state, t, target);
    return;
  }
  if (t.flies) {
    t.engageId = -1;
    walkTo(t, target.cx, target.cy);
    return;
  }
  const field = fieldFor(state, target, t.range);
  const tile = tileOf(state, t.x, t.y);
  if (field[tile]! >= INF) {
    // No route at all (should not happen on valid bases): walk straight at it.
    t.engageId = -1;
    walkTo(t, target.cx, target.cy);
    return;
  }
  const n = nextTile(state, field, tile);
  if (n < 0) {
    // On a goal tile but not yet in range: close in on the tile centre.
    t.engageId = -1;
    const w = state.gridW;
    walkTo(t, (tile % w) * UNIT + UNIT / 2, Math.floor(tile / w) * UNIT + UNIT / 2);
    return;
  }
  const wall = wallAt(state, n);
  if (wall) {
    t.engageId = wall.id;
    if (inRange(t, wall)) {
      if (t.cooldown === 0) attack(state, t, wall);
      return;
    }
    walkTo(t, wall.cx, wall.cy);
    return;
  }
  t.engageId = -1;
  const w = state.gridW;
  walkTo(t, (n % w) * UNIT + UNIT / 2, Math.floor(n / w) * UNIT + UNIT / 2);
}

function walkTo(t: Troop, x: number, y: number) {
  if (x === t.x && y === t.y) return;
  t.facing = dirIndex(x - t.x, y - t.y);
  stepToward(t.x, t.y, x, y, t.speed, tmp);
  t.x = tmp.x;
  t.y = tmp.y;
  t.moving = true;
}

/**
 * Keep ground troops from stacking on one point (ported from the reused unit separation, with
 * the 16-direction table in place of cos/sin). Only walking troops are pushed, at most 1/8 of
 * the overlap per tick, and never onto a blocked tile.
 */
export function separateTroops(state: BattleState) {
  const list = state.troops;
  const s2 = SEPARATION * SEPARATION;
  for (let i = 0; i < list.length; i++) {
    const a = list[i]!;
    if (!a.alive || a.flies) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j]!;
      if (!b.alive || b.flies) continue;
      const ax = a.x - b.x;
      const ay = a.y - b.y;
      if (ax >= SEPARATION || ax <= -SEPARATION || ay >= SEPARATION || ay <= -SEPARATION) continue;
      const d2 = dist2(a.x, a.y, b.x, b.y);
      if (d2 >= s2) continue;
      let dx: number;
      let dy: number;
      let len: number;
      if (d2 === 0) {
        const dir = DIR16[(a.id * 7 + b.id * 3) % 16]!;
        dx = dir[0];
        dy = dir[1];
        len = 1024;
      } else {
        dx = b.x - a.x;
        dy = b.y - a.y;
        len = isqrt(d2);
      }
      const push = idiv(SEPARATION - (d2 === 0 ? 0 : len), 8);
      if (push <= 0) continue;
      const px = idiv(dx * push, len);
      const py = idiv(dy * push, len);
      if (a.moving) nudge(state, a, -px, -py);
      if (b.moving) nudge(state, b, px, py);
    }
  }
}

function nudge(state: BattleState, t: Troop, dx: number, dy: number) {
  const nx = t.x + dx;
  const ny = t.y + dy;
  const maxX = state.gridW * UNIT - 1;
  const maxY = state.gridH * UNIT - 1;
  if (nx < 0 || ny < 0 || nx > maxX || ny > maxY) return;
  if (blocked(state, tileOf(state, nx, ny))) return;
  t.x = nx;
  t.y = ny;
}
