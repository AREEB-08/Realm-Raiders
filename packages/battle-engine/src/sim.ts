import {
  BUILDING_IDS,
  BUILDINGS,
  TROOP_IDS,
  TROOPS,
  attackRenown,
  buildingHp,
  isResourceBuilding,
  lootFrom,
  troopDps,
  troopHitDamage,
  troopHp,
  troopTable,
  defenceFor,
  type TroopId,
} from '@realm/game-data';
import { MAX_TICKS, MILLI, SUPPORTED_ENGINE_VERSIONS, TICK_HZ, UNIT } from './constants';
import { separateTroops, updateTroop } from './combat';
import { updateDefences } from './defences';
import { clearOccupancy, deployAllowed, fillNoDeploy, fillOccupancy } from './grid';
import { fillPass } from './pathfinding';
import { fromHex, keccak } from './hash';
import { rally } from './hero';
import { idiv } from './math';
import { landProjectiles } from './projectiles';
import { Sfc32 } from './rng';
import { updateTraps } from './traps';
import type {
  Action,
  BattleInput,
  BattleResult,
  BattleState,
  Building,
  EndReason,
  Troop,
} from './types';
import { normalizeBase, baseErrors } from './layout-codec';

export function validateInput(input: BattleInput): string[] {
  const errors: string[] = [];
  if (!SUPPORTED_ENGINE_VERSIONS.includes(input.engineVersion))
    errors.push(`engine version ${input.engineVersion} is not supported (${SUPPORTED_ENGINE_VERSIONS.join(', ')})`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.seed)) errors.push('seed must be bytes32 hex');
  errors.push(...baseErrors(input.base));
  const roster = troopTable(input.engineVersion);
  for (const e of input.army.troops) {
    const def = TROOPS[e.troop] ? roster[e.troop] : undefined;
    if (!def) errors.push(`unknown troop ${e.troop} for engine v${input.engineVersion}`);
    else if (e.level < 1 || e.level > def.maxLevel) errors.push(`bad level for ${e.troop}`);
    if (!Number.isInteger(e.count) || e.count < 0 || e.count > 400) errors.push(`bad count for ${e.troop}`);
    if (e.troop === 'general' && e.count > 1) errors.push('one General per battle');
  }
  let last = -1;
  for (const a of input.actions) {
    if (!Number.isInteger(a.t) || a.t < 0 || a.t >= MAX_TICKS) errors.push('action tick out of range');
    if (a.t < last) errors.push('actions must be sorted by tick');
    last = a.t;
  }
  return errors;
}

function makeBuilding(id: number, b: BattleInput['base']['buildings'][number], v: number): Building {
  const def = BUILDINGS[b.type];
  const hp = buildingHp(b.type, b.level) * MILLI;
  const wall = def.category === 'wall';
  const trap = def.category === 'trap';
  const x0 = b.x * UNIT;
  const y0 = b.y * UNIT;
  const x1 = (b.x + def.size) * UNIT;
  const y1 = (b.y + def.size) * UNIT;
  return {
    id,
    type: b.type,
    typeIdx: BUILDING_IDS.indexOf(b.type),
    def,
    level: b.level,
    x: b.x,
    y: b.y,
    size: def.size,
    x0,
    y0,
    x1,
    y1,
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    hp,
    maxHp: hp,
    alive: true,
    wall,
    trap,
    resource: isResourceBuilding(b.type),
    weight: wall || trap ? 0 : hp,
    defence: defenceFor(b.type, v),
    trapDef: def.trap ?? null,
    cooldown: 0,
    targetId: -1,
    lockTicks: 0,
    trapFireTick: -1,
    hitTick: -100,
  };
}

/** Build the incremental battle state (client live battle; §13.4). */
export function createBattle(input: BattleInput): BattleState {
  const errors = validateInput(input);
  if (errors.length) throw new Error(`invalid battle input: ${errors.join('; ')}`);
  const base = normalizeBase(input.base);
  const v = input.engineVersion;
  const buildings = base.buildings.map((b, i) => makeBuilding(i, b, v));
  const remaining = TROOP_IDS.map(() => 0);
  for (const e of input.army.troops) remaining[TROOP_IDS.indexOf(e.troop)]! += e.count;
  const state: BattleState = {
    input: { ...input, base, actions: [...input.actions] },
    v,
    roster: troopTable(v),
    tick: 0,
    rng: new Sfc32(fromHex(input.seed)),
    buildings,
    troops: [],
    projectiles: [],
    occ: new Int16Array(base.gridW * base.gridH),
    pass: new Uint8Array(base.gridW * base.gridH),
    noDeploy: new Uint8Array(base.gridW * base.gridH),
    gridW: base.gridW,
    gridH: base.gridH,
    layoutVersion: 0,
    fields: new Map(),
    pending: [...input.actions],
    applied: [],
    remaining,
    remainingTotal: remaining.reduce((a, b) => a + b, 0),
    generalId: -1,
    rallyUsed: false,
    rallyUntil: 0,
    totalWeight: buildings.reduce((n, b) => n + b.weight, 0),
    destroyedWeight: 0,
    destructionBp: 0,
    stars: 0,
    citadelDestroyed: false,
    ended: false,
    endReason: null,
    events: [],
    fx: [],
    nextId: 1,
    deployed: TROOP_IDS.map(() => 0),
    lost: TROOP_IDS.map(() => 0),
    damageBy: TROOP_IDS.map(() => 0),
  };
  fillOccupancy(state);
  fillPass(state);
  fillNoDeploy(state);
  return state;
}

function levelOf(state: BattleState, troop: TroopId): number {
  return state.input.army.troops.find((e) => e.troop === troop)?.level ?? 1;
}

/** Whether a deploy would be accepted right now (the client checks before recording it). */
export function canDeploy(state: BattleState, troop: TroopId, x10: number, y10: number): boolean {
  if (state.ended) return false;
  const idx = TROOP_IDS.indexOf(troop);
  if (idx < 0 || state.remaining[idx]! <= 0) return false;
  return deployAllowed(state.noDeploy, state.gridW, state.gridH, x10, y10);
}

function spawnTroop(state: BattleState, kind: TroopId, x10: number, y10: number): Troop {
  const def = state.roster[kind]!;
  const level = levelOf(state, kind);
  const hp = troopHp(kind, level, state.v) * MILLI;
  // v1: damage per second spread over the attack interval (the launch formula, unchanged).
  // v2: the spec's damage per hit (per fireball for the Ember Mage).
  const dmgPerHit =
    state.v === 1 ? idiv(troopDps(kind, level, 1) * MILLI * def.attackTicks, TICK_HZ) : troopHitDamage(kind, level, state.v) * MILLI;
  const t: Troop = {
    id: state.troops.length,
    kind,
    kindIdx: TROOP_IDS.indexOf(kind),
    def,
    level,
    x: x10 * 100,
    y: y10 * 100,
    hp,
    maxHp: hp,
    alive: true,
    flies: def.flies,
    speed: idiv(def.speed, TICK_HZ),
    range: def.range,
    dmgPerHit,
    cooldown: 0,
    targetId: -1,
    engageId: -1,
    facing: 2,
    everTargeted: false,
    moving: false,
    attackTick: -100,
    hitTick: -100,
  };
  state.troops.push(t);
  return t;
}

function applyAction(state: BattleState, a: Action) {
  if (a.kind === 'end') {
    state.applied.push(a);
    finish(state, 'ended');
    return;
  }
  if (a.kind === 'rally') {
    if (rally(state)) state.applied.push(a);
    return;
  }
  if (!canDeploy(state, a.troop, a.x, a.y)) return;
  const idx = TROOP_IDS.indexOf(a.troop);
  state.remaining[idx]!--;
  state.remainingTotal--;
  state.deployed[idx]!++;
  const t = spawnTroop(state, a.troop, a.x, a.y);
  if (a.troop === 'general') state.generalId = t.id;
  state.applied.push(a);
  state.events.push({ t: state.tick, k: 'deploy', id: t.id, troop: a.troop });
  state.fx.push({ k: 'deploy', id: t.id });
}

function computeStars(state: BattleState) {
  return (
    (state.destructionBp >= 5000 ? 1 : 0) +
    (state.citadelDestroyed ? 1 : 0) +
    (state.destructionBp >= 10000 ? 1 : 0)
  );
}

function removeDead(state: BattleState) {
  for (const t of state.troops) {
    if (t.alive && t.hp <= 0) {
      t.alive = false;
      t.hp = 0;
      state.lost[t.kindIdx]!++;
      state.events.push({ t: state.tick, k: 'died', id: t.id, troop: t.kind });
      state.fx.push({ k: 'died', id: t.id });
    }
  }
  let blockingFell = false;
  for (const b of state.buildings) {
    if (!b.alive || b.trap || b.hp > 0) continue;
    b.alive = false;
    b.hp = 0;
    clearOccupancy(state, b);
    blockingFell = true;
    state.destroyedWeight += b.weight;
    if (b.type === 'citadel') state.citadelDestroyed = true;
    state.events.push({ t: state.tick, k: 'destroyed', id: b.id, type: b.type });
    state.fx.push({ k: 'destroyed', id: b.id });
  }
  if (blockingFell) {
    state.layoutVersion++;
    state.fields = new Map();
  }
  const bp =
    state.totalWeight === 0
      ? 10000
      : Math.floor((state.destroyedWeight * 10000) / state.totalWeight);
  state.destructionBp = bp;
  const stars = computeStars(state);
  if (stars > state.stars) {
    state.stars = stars;
    state.events.push({ t: state.tick, k: 'star', stars });
  }
}

function finish(state: BattleState, reason: EndReason) {
  if (state.ended) return;
  state.ended = true;
  state.endReason = reason;
  state.events.push({ t: state.tick, k: 'end', reason });
}

function checkEnd(state: BattleState) {
  if (state.ended) return;
  if (state.destructionBp >= 10000) return finish(state, 'razed');
  const anyAlive = state.troops.some((t) => t.alive);
  const troopShots = state.projectiles.some((p) => p.from === 'troop');
  if (!anyAlive && !troopShots && state.remainingTotal === 0 && state.troops.length > 0)
    return finish(state, 'wiped');
  if (state.tick + 1 >= MAX_TICKS) return finish(state, 'time');
}

/**
 * Advance one tick in the fixed order of §13.3. `newActions` are queued (in order) and those
 * scheduled for this tick are applied first.
 */
export function step(state: BattleState, newActions?: Action[]) {
  if (state.ended) return;
  state.fx = [];
  if (newActions?.length) {
    for (const a of newActions) {
      if (a.t < state.tick) throw new Error('cannot schedule an action in the past');
      state.pending.push(a);
    }
    state.pending.sort((a, b) => a.t - b.t);
  }
  // 1. inputs for this tick, in arrival order
  while (state.pending.length && state.pending[0]!.t === state.tick) {
    applyAction(state, state.pending.shift()!);
    if (state.ended) return;
  }
  // 2–4. retarget, path, move, attack (troops in id order), then defences, impacts, traps
  for (const t of state.troops) updateTroop(state, t);
  // Separation is cosmetic spacing; every other tick is enough and halves its cost.
  if ((state.tick & 1) === 0) separateTroops(state);
  updateDefences(state);
  landProjectiles(state);
  updateTraps(state);
  // 5. remove the dead
  removeDead(state);
  // 6. end conditions
  checkEnd(state);
  if (!state.ended) state.tick++;
}

export function stateHash(state: BattleState) {
  const words: number[] = [state.tick, ...state.rng.snapshot(), state.destructionBp, state.layoutVersion];
  for (const t of state.troops) words.push(t.id, t.alive ? 1 : 0, t.x, t.y, t.hp, t.targetId, t.cooldown);
  for (const b of state.buildings) words.push(b.alive ? 1 : 0, b.hp, b.targetId, b.cooldown, b.lockTicks);
  for (const p of state.projectiles) words.push(p.id, p.impactTick, p.damage, p.targetId, p.x, p.y);
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setInt32(i * 4, w | 0, true));
  return keccak(bytes);
}

export function resultOf(state: BattleState): BattleResult {
  const input = state.input;
  const stars = Math.min(3, state.stars) as 0 | 1 | 2 | 3;
  const destructionPct = state.destructionBp / 100;
  const targetCitadel = input.base.buildings.find((b) => b.type === 'citadel')?.level ?? 1;
  const higher = input.attackerCitadel !== undefined && targetCitadel > input.attackerCitadel;
  const renown = attackRenown(stars, destructionPct, higher);
  const full = input.defenderStored ? lootFrom(input.defenderStored) : { gold: 0, timber: 0 };
  const loot = {
    gold: Math.floor((full.gold * state.destructionBp) / 10000),
    timber: Math.floor((full.timber * state.destructionBp) / 10000),
  };
  const tally = (arr: number[]) => {
    const out: Record<string, number> = {};
    arr.forEach((n, i) => {
      if (n) out[TROOP_IDS[i]!] = n;
    });
    return out;
  };
  return {
    stars,
    destructionPct,
    destructionBp: state.destructionBp,
    citadelDestroyed: state.citadelDestroyed,
    ticks: state.tick + 1,
    renown,
    loot,
    endReason: state.endReason ?? 'time',
    events: state.events,
    stateHash: stateHash(state),
    deployed: tally(state.deployed),
    lost: tally(state.lost),
    damageBy: tally(state.damageBy),
  };
}

/** Run a whole battle (server Strategist, verifier). */
export function simulate(input: BattleInput, onTick?: (state: BattleState) => void): BattleResult {
  const state = createBattle(input);
  while (!state.ended) {
    step(state);
    onTick?.(state);
  }
  return resultOf(state);
}
