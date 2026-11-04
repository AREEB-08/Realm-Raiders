import type { BuildingId, ResourceId } from './ids';
import { atLevel, scaleTable } from './scale';

export type BuildingCategory =
  | 'core'
  | 'resource'
  | 'storage'
  | 'army'
  | 'defence'
  | 'wall'
  | 'trap';

export interface DefenceDef {
  /** Max range in milli-tiles (1 tile = 1000). */
  range: number;
  /** Min range in milli-tiles (stonethrower). */
  minRange: number;
  hitsAir: boolean;
  hitsGround: boolean;
  /** Ticks between shots (20 ticks = 1 s). Obelisk: 1 (continuous beam). */
  intervalTicks: number;
  /** Damage per shot at L1, in HP. Obelisk uses `rampDps` instead. */
  damage: number;
  /** Projectile flight time in ticks (0 = instant). */
  flightTicks: number;
  /** Splash radius in milli-tiles (0 = single target). */
  splash: number;
  /** Obelisk ramp: dps per stage and the lock ticks at which the next stage starts. */
  rampDps?: readonly [number, number, number];
  rampSwitchTicks?: readonly [number, number];
}

export interface TrapDef {
  triggerRadius: number;
  delayTicks: number;
  damage: number;
  splash: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  /** Short flavour line for the shop. */
  blurb: string;
  size: number;
  hpL1: number;
  maxLevel: number;
  category: BuildingCategory;
  cost: { base: number; resource: ResourceId };
  produces?: { resource: ResourceId; perHourL1: number };
  stores?: { resource: ResourceId; capacityL1: number };
  defence?: DefenceDef;
  trap?: TrapDef;
  /** Citadel level needed before the first one can be built. */
  unlockCitadel: number;
}

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  citadel: {
    id: 'citadel',
    name: 'Citadel',
    blurb: 'Seat of your holdfast. Raising it unlocks every other upgrade.',
    size: 4,
    hpL1: 2400,
    maxLevel: 5,
    category: 'core',
    cost: { base: 1000, resource: 'gold' },
    unlockCitadel: 1,
  },
  goldworks: {
    id: 'goldworks',
    name: 'Goldworks',
    blurb: 'Smelts Gold Marks from shore ore.',
    size: 3,
    hpL1: 400,
    maxLevel: 5,
    category: 'resource',
    cost: { base: 150, resource: 'timber' },
    produces: { resource: 'gold', perHourL1: 200 },
    unlockCitadel: 1,
  },
  treasury: {
    id: 'treasury',
    name: 'Treasury',
    blurb: 'Iron-bound vaults for your Gold Marks.',
    size: 3,
    hpL1: 600,
    maxLevel: 5,
    category: 'storage',
    cost: { base: 300, resource: 'timber' },
    stores: { resource: 'gold', capacityL1: 5000 },
    unlockCitadel: 1,
  },
  lumbercamp: {
    id: 'lumbercamp',
    name: 'Lumber Camp',
    blurb: 'Fells storm-pine for Timber.',
    size: 3,
    hpL1: 400,
    maxLevel: 5,
    category: 'resource',
    cost: { base: 150, resource: 'gold' },
    produces: { resource: 'timber', perHourL1: 200 },
    unlockCitadel: 1,
  },
  timberyard: {
    id: 'timberyard',
    name: 'Timber Yard',
    blurb: 'Stacked and seasoned Timber, ready for walls.',
    size: 3,
    hpL1: 600,
    maxLevel: 5,
    category: 'storage',
    cost: { base: 300, resource: 'gold' },
    stores: { resource: 'timber', capacityL1: 5000 },
    unlockCitadel: 1,
  },
  emberwell: {
    id: 'emberwell',
    name: 'Ember Well',
    blurb: 'Draws warm Ember from the fallen wyrm’s bones.',
    size: 2,
    hpL1: 500,
    maxLevel: 3,
    category: 'resource',
    cost: { base: 400, resource: 'gold' },
    produces: { resource: 'ember', perHourL1: 20 },
    unlockCitadel: 3,
  },
  musterhall: {
    id: 'musterhall',
    name: 'Muster Hall',
    blurb: 'Drills your raiders. Each level raises troop rank.',
    size: 3,
    hpL1: 500,
    maxLevel: 5,
    category: 'army',
    cost: { base: 200, resource: 'timber' },
    unlockCitadel: 1,
  },
  warcamp: {
    id: 'warcamp',
    name: 'War Camp',
    blurb: 'Tents and fires for the raiding host.',
    size: 4,
    hpL1: 300,
    maxLevel: 5,
    category: 'army',
    cost: { base: 200, resource: 'timber' },
    unlockCitadel: 1,
  },
  bowtower: {
    id: 'bowtower',
    name: 'Bowyer Tower',
    blurb: 'Longbows on a timber spire. Hits air and ground.',
    size: 3,
    hpL1: 380,
    maxLevel: 5,
    category: 'defence',
    cost: { base: 250, resource: 'gold' },
    defence: {
      range: 7000,
      minRange: 0,
      hitsAir: true,
      hitsGround: true,
      intervalTicks: 10,
      damage: 8,
      flightTicks: 6,
      splash: 0,
    },
    unlockCitadel: 1,
  },
  stonethrower: {
    id: 'stonethrower',
    name: 'Stonethrower',
    blurb: 'Lobs basalt over walls. Slow, heavy, ground only.',
    size: 3,
    hpL1: 420,
    maxLevel: 5,
    category: 'defence',
    cost: { base: 500, resource: 'gold' },
    defence: {
      range: 9000,
      minRange: 4000,
      hitsAir: false,
      hitsGround: true,
      intervalTicks: 50,
      damage: 30,
      flightTicks: 20,
      splash: 1500,
    },
    unlockCitadel: 2,
  },
  obelisk: {
    id: 'obelisk',
    name: 'Rune Obelisk',
    blurb: 'A rune-beam that burns hotter the longer it holds a foe.',
    size: 2,
    hpL1: 600,
    maxLevel: 3,
    category: 'defence',
    cost: { base: 1200, resource: 'gold' },
    defence: {
      range: 5000,
      minRange: 0,
      hitsAir: true,
      hitsGround: true,
      intervalTicks: 1,
      damage: 0,
      flightTicks: 0,
      splash: 0,
      rampDps: [10, 30, 60],
      rampSwitchTicks: [40, 100],
    },
    unlockCitadel: 3,
  },
  ballista: {
    id: 'ballista',
    name: 'Wyrm Ballista',
    blurb: 'Bolts as long as a spear. Built to drop drakes.',
    size: 3,
    hpL1: 700,
    maxLevel: 3,
    category: 'defence',
    cost: { base: 1000, resource: 'gold' },
    defence: {
      range: 8000,
      minRange: 0,
      hitsAir: true,
      hitsGround: false,
      intervalTicks: 24,
      damage: 55,
      flightTicks: 8,
      splash: 0,
    },
    unlockCitadel: 3,
  },
  wall: {
    id: 'wall',
    name: 'Stone Wall',
    blurb: 'Blocks ground raiders until broken.',
    size: 1,
    hpL1: 300,
    maxLevel: 5,
    category: 'wall',
    cost: { base: 50, resource: 'gold' },
    unlockCitadel: 1,
  },
  caltrops: {
    id: 'caltrops',
    name: 'Caltrop Pit',
    blurb: 'Hidden iron spikes. Springs once.',
    size: 1,
    hpL1: 1,
    maxLevel: 3,
    category: 'trap',
    cost: { base: 100, resource: 'gold' },
    trap: { triggerRadius: 700, delayTicks: 2, damage: 80, splash: 1000 },
    unlockCitadel: 1,
  },
};

/** Per-citadel-level (index 0 = Citadel 1) count limits. */
export const BUILDING_LIMITS: Record<BuildingId, readonly number[]> = {
  citadel: [1, 1, 1, 1, 1],
  goldworks: [2, 2, 3, 3, 4],
  treasury: [1, 1, 2, 2, 2],
  lumbercamp: [2, 2, 3, 3, 4],
  timberyard: [1, 1, 2, 2, 2],
  emberwell: [0, 0, 1, 1, 2],
  musterhall: [1, 1, 1, 1, 1],
  warcamp: [1, 1, 2, 2, 2],
  bowtower: [2, 2, 3, 3, 4],
  stonethrower: [1, 1, 2, 2, 2],
  obelisk: [0, 0, 1, 1, 2],
  ballista: [0, 0, 1, 1, 1],
  wall: [50, 75, 100, 125, 150],
  caltrops: [4, 4, 6, 6, 8],
};

export const HP_PCT_PER_LEVEL = 35;
export const OUTPUT_PCT_PER_LEVEL = 25;

const hpTables = {} as Record<BuildingId, number[]>;
for (const def of Object.values(BUILDINGS)) {
  hpTables[def.id] = scaleTable(def.hpL1, HP_PCT_PER_LEVEL, def.maxLevel);
}

/** Building HP at a level (whole HP). */
export function buildingHp(id: BuildingId, level: number): number {
  return atLevel(hpTables[id], level);
}

/** Damage / dps / output scaling (×1.25 per level). */
export function scaleOutput(valueL1: number, level: number): number {
  let v = valueL1;
  for (let l = 1; l < level; l++) v = Math.floor((v * (100 + OUTPUT_PCT_PER_LEVEL)) / 100);
  return v;
}

export function limitFor(id: BuildingId, citadelLevel: number): number {
  const row = BUILDING_LIMITS[id];
  return row[Math.max(1, Math.min(row.length, citadelLevel)) - 1]!;
}

/** Highest level this building may reach under a given Citadel level. */
export function maxLevelFor(id: BuildingId, citadelLevel: number): number {
  const def = BUILDINGS[id];
  if (id === 'citadel') return def.maxLevel;
  return Math.min(def.maxLevel, Math.max(1, citadelLevel));
}

/**
 * Engine v2 changes to defences (spec F4 air rules + counters). v1 keeps the launch numbers so
 * old replays re-simulate exactly. Applied on top of `BUILDINGS[id].defence`.
 * - Rune Obelisk: ground only.
 * - Wyrm Ballista: heavier bolts — "built to drop drakes" — so it punishes the Fire Dragon.
 */
export const DEFENCE_V2: Partial<Record<BuildingId, Partial<DefenceDef>>> = {
  obelisk: { hitsAir: false },
  ballista: { damage: 140, range: 11000 },
};

/** A building's defence under an engine version (null if it is not a defence). */
export function defenceFor(id: BuildingId, engineVersion: number): DefenceDef | null {
  const d = BUILDINGS[id].defence;
  if (!d) return null;
  if (engineVersion < 2) return d;
  const o = DEFENCE_V2[id];
  return o ? { ...d, ...o } : d;
}

export const isResourceBuilding = (id: BuildingId) =>
  BUILDINGS[id].category === 'resource' || BUILDINGS[id].category === 'storage';
export const isDefence = (id: BuildingId) => BUILDINGS[id].category === 'defence';
