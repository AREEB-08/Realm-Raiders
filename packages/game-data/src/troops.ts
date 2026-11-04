import type { ResourceId, TroopId } from './ids';
import { atLevel, scaleTable } from './scale';

export type TargetPreference = 'nearest' | 'walls' | 'resources' | 'defences';

export interface TroopDef {
  id: TroopId;
  name: string;
  blurb: string;
  housing: number;
  hp: number;
  /** Damage per second (engine v1 only; v2 uses `damage` per hit). */
  dps: number;
  /** Damage per hit at level 1, in HP (engine v2). A volley troop deals this per projectile. */
  damage: number;
  /** Attack range in milli-tiles. */
  range: number;
  /** Speed in milli-tiles per second. */
  speed: number;
  targets: TargetPreference;
  flies: boolean;
  /** Ticks between attacks (20 ticks = 1 s). */
  attackTicks: number;
  /** Projectile flight in ticks for ranged troops (0 = melee / breath, instant). */
  flightTicks: number;
  /** Splash radius in milli-tiles (0 = single target). */
  splash: number;
  /** Damage multiplier vs the preferred category, in percent (100 = none). */
  preferredBonusPct: number;
  /** Sapper: one big hit, then it is spent. */
  detonates: boolean;
  /** Ember Mage (v2): fireballs per attack, fanned sideways by `fanSpread` milli-tiles. */
  volley?: number;
  fanSpread?: number;
  /**
   * Fire Dragon (v2): breath hits everything in a cone towards the target. `tan1000` is
   * tan(half-angle) × 1000; `reach` is how far past the target the fire carries (milli-tiles).
   */
  cone?: { tan1000: number; reach: number };
  /** Stone Giant (v2): fist slam (a camera shake in the renderer; no extra rule). */
  slam?: boolean;
  cost: { amount: number; resource: ResourceId };
  maxLevel: number;
}

/**
 * Engine v1 roster, FROZEN. Every replay recorded before the troop update says engineVersion 1
 * and must keep re-simulating bit-identically (old raids on Monad, the v1 goldens, the v1
 * digest). Never edit these numbers; display names may follow the current roster.
 */
export const TROOPS_V1: Partial<Record<TroopId, TroopDef>> = {
  shield: {
    id: 'shield',
    name: 'Swordsman',
    blurb: 'Tower-shield infantry (engine v1).',
    housing: 2,
    hp: 260,
    dps: 14,
    damage: 14,
    range: 600,
    speed: 900,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 60, resource: 'timber' },
    maxLevel: 3,
  },
  longbow: {
    id: 'longbow',
    name: 'Archer',
    blurb: 'Fen archers (engine v1).',
    housing: 1,
    hp: 70,
    dps: 12,
    damage: 12,
    range: 3500,
    speed: 1200,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 5,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 40, resource: 'timber' },
    maxLevel: 3,
  },
  sapper: {
    id: 'sapper',
    name: 'Sapper',
    blurb: 'Powder keg runner (engine v1).',
    housing: 1,
    hp: 50,
    dps: 160,
    damage: 160,
    range: 600,
    speed: 1600,
    targets: 'walls',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 1000,
    preferredBonusPct: 100,
    detonates: true,
    cost: { amount: 80, resource: 'timber' },
    maxLevel: 3,
  },
  ravager: {
    id: 'ravager',
    name: 'Ravager',
    blurb: 'Raiders with crowbars (engine v1).',
    housing: 2,
    hp: 120,
    dps: 30,
    damage: 30,
    range: 600,
    speed: 1400,
    targets: 'resources',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 200,
    detonates: false,
    cost: { amount: 70, resource: 'timber' },
    maxLevel: 3,
  },
  drake: {
    id: 'drake',
    name: 'Drakeling',
    blurb: 'A young storm-drake (engine v1).',
    housing: 5,
    hp: 600,
    dps: 40,
    damage: 50,
    range: 2500,
    speed: 1000,
    targets: 'nearest',
    flies: true,
    attackTicks: 25,
    flightTicks: 6,
    splash: 1000,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 25, resource: 'ember' },
    maxLevel: 3,
  },
  general: {
    id: 'general',
    name: 'General',
    blurb: 'Your own General (engine v1).',
    housing: 0,
    hp: 1500,
    dps: 55,
    damage: 55,
    range: 1000,
    speed: 1100,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 0, resource: 'gold' },
    maxLevel: 3,
  },
};

/**
 * Engine v2 roster (spec F4). Internal ids stay stable for the replay byte encoding:
 * shield = Swordsman, longbow = Archer, ravager = Stone Giant, drake = Fire Dragon, and
 * `mage` is new. Speeds are the spec's tile-thousandths per tick × 3 (decision Q2), stored per
 * second: 16/tick → 960 milli-tiles/s.
 */
export const TROOPS: Record<TroopId, TroopDef> = {
  shield: {
    id: 'shield',
    name: 'Swordsman',
    blurb: 'Charges in and slashes with his sword. Cheap, brave, everywhere at once.',
    housing: 1,
    hp: 110,
    dps: 12,
    damage: 12,
    range: 600,
    speed: 960,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 25, resource: 'timber' },
    maxLevel: 3,
  },
  longbow: {
    id: 'longbow',
    name: 'Archer',
    blurb: 'Fires arrows over walls from a safe distance. Fragile up close.',
    housing: 1,
    hp: 45,
    dps: 9,
    damage: 9,
    range: 3500,
    speed: 1200,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 5,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 30, resource: 'timber' },
    maxLevel: 3,
  },
  sapper: {
    id: 'sapper',
    name: 'Sapper',
    blurb: 'Runs for the walls and blows them open.',
    housing: 1,
    hp: 50,
    dps: 160,
    damage: 160,
    range: 600,
    speed: 1600,
    targets: 'walls',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 1000,
    preferredBonusPct: 100,
    detonates: true,
    cost: { amount: 80, resource: 'timber' },
    maxLevel: 3,
  },
  ravager: {
    id: 'ravager',
    name: 'Stone Giant',
    blurb: 'A towering brute who smashes defences with his bare fists. Soaks up damage for your army.',
    housing: 5,
    hp: 800,
    dps: 15,
    damage: 30,
    range: 1000,
    speed: 720,
    targets: 'defences',
    flies: false,
    attackTicks: 40,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 200,
    detonates: false,
    slam: true,
    cost: { amount: 150, resource: 'timber' },
    maxLevel: 3,
  },
  drake: {
    id: 'drake',
    name: 'Fire Dragon',
    blurb: 'Flies over every wall and breathes fire from the sky. Beware the Ballista.',
    housing: 20,
    hp: 1900,
    dps: 112,
    damage: 140,
    range: 3000,
    speed: 960,
    targets: 'nearest',
    flies: true,
    attackTicks: 25,
    flightTicks: 0,
    splash: 600,
    preferredBonusPct: 100,
    detonates: false,
    cone: { tan1000: 577, reach: 600 },
    cost: { amount: 60, resource: 'ember' },
    maxLevel: 3,
  },
  general: {
    id: 'general',
    name: 'General',
    blurb: 'Your own General. One per battle. Can Rally once.',
    housing: 0,
    hp: 1500,
    dps: 55,
    damage: 55,
    range: 1000,
    speed: 1100,
    targets: 'nearest',
    flies: false,
    attackTicks: 20,
    flightTicks: 0,
    splash: 0,
    preferredBonusPct: 100,
    detonates: false,
    cost: { amount: 0, resource: 'gold' },
    maxLevel: 3,
  },
  mage: {
    id: 'mage',
    name: 'Ember Mage',
    blurb: 'Throws a spray of three fireballs. Melts groups of enemies.',
    housing: 4,
    hp: 90,
    dps: 41,
    damage: 22,
    range: 3000,
    speed: 960,
    targets: 'nearest',
    flies: false,
    attackTicks: 32,
    flightTicks: 8,
    splash: 800,
    preferredBonusPct: 100,
    detonates: false,
    volley: 3,
    fanSpread: 900,
    cost: { amount: 120, resource: 'timber' },
    maxLevel: 3,
  },
};

export const TROOP_PCT_PER_LEVEL = 20;

/** Rally: +25 % damage for troops within 5 tiles of the General for 6 s (120 ticks). */
export const RALLY = { bonusPct: 125, radius: 5000, ticks: 120 } as const;

/** The roster an engine version plays with (v1 frozen, v2 current). */
export function troopTable(engineVersion: number): Partial<Record<TroopId, TroopDef>> {
  return engineVersion === 1 ? TROOPS_V1 : TROOPS;
}

const tables = new Map<string, number[]>();
function table(engineVersion: number, id: TroopId, field: 'hp' | 'dps' | 'damage') {
  const key = `${engineVersion}:${id}:${field}`;
  let t = tables.get(key);
  if (!t) {
    const def = troopTable(engineVersion)[id];
    if (!def) throw new Error(`troop ${id} is not in engine v${engineVersion}`);
    t = scaleTable(def[field], TROOP_PCT_PER_LEVEL, def.maxLevel);
    tables.set(key, t);
  }
  return t;
}

/** Troop HP at a level (whole HP). Defaults to the current roster. */
export const troopHp = (id: TroopId, level: number, engineVersion = 2) => atLevel(table(engineVersion, id, 'hp'), level);
/** v1 damage per second at a level. */
export const troopDps = (id: TroopId, level: number, engineVersion = 1) => atLevel(table(engineVersion, id, 'dps'), level);
/** v2 damage per hit (per projectile for a volley) at a level. */
export const troopHitDamage = (id: TroopId, level: number, engineVersion = 2) => atLevel(table(engineVersion, id, 'damage'), level);

/** "16 Swordsmen", "1 Fire Dragon", "the Archers" — display plural of a troop name. */
export function troopPlural(id: TroopId) {
  const n = TROOPS[id].name;
  return id === 'general' ? n : n.endsWith('man') ? `${n.slice(0, -3)}men` : `${n}s`;
}
export const troopLabel = (id: TroopId, count: number) => `${count} ${count === 1 || id === 'general' ? TROOPS[id].name : troopPlural(id)}`;

/** Troops that can be put in an army (the General is added separately, one per battle). */
export const ARMY_TROOPS: readonly TroopId[] = ['shield', 'longbow', 'sapper', 'ravager', 'mage', 'drake'];
