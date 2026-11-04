import type {
  BuildingDef,
  BuildingId,
  DefenceDef,
  TrapDef,
  TroopDef,
  TroopId,
} from '@realm/game-data';
import type { Hex } from './hash';
import type { Sfc32 } from './rng';

/** The canonical, hashable layout of a base (no instance ids, no timers). */
export interface SealedBase {
  v: 1;
  gridW: number;
  gridH: number;
  buildings: { type: BuildingId; level: number; x: number; y: number }[];
}

export interface ArmyEntry {
  troop: TroopId;
  level: number;
  count: number;
}
export interface ArmyComp {
  troops: ArmyEntry[];
}

export type Action =
  | { t: number; kind: 'deploy'; troop: TroopId; x: number; y: number } // x, y in tiles × 10
  | { t: number; kind: 'rally' }
  | { t: number; kind: 'end' };

export interface BattleInput {
  engineVersion: number;
  seed: Hex;
  base: SealedBase;
  army: ArmyComp;
  /** Sorted by tick, then arrival order. */
  actions: Action[];
  /** Optional scoring context (not part of the replay; the server supplies it). */
  attackerCitadel?: number;
  defenderStored?: { gold: number; timber: number };
}

export type EndReason = 'time' | 'razed' | 'wiped' | 'ended';

export type SimEvent =
  | { t: number; k: 'deploy'; id: number; troop: TroopId }
  | { t: number; k: 'rally' }
  | { t: number; k: 'destroyed'; id: number; type: BuildingId }
  | { t: number; k: 'died'; id: number; troop: TroopId }
  | { t: number; k: 'trap'; id: number; hits: number }
  | { t: number; k: 'star'; stars: number }
  | { t: number; k: 'end'; reason: EndReason };

export interface BattleResult {
  stars: 0 | 1 | 2 | 3;
  destructionPct: number;
  destructionBp: number;
  citadelDestroyed: boolean;
  ticks: number;
  renown: number;
  loot: { gold: number; timber: number };
  endReason: EndReason;
  events: SimEvent[];
  /** keccak of the final state (witness). */
  stateHash: Hex;
  /** Troops deployed / lost, for reports. */
  deployed: Record<string, number>;
  lost: Record<string, number>;
  /** Destroyed-building damage dealt per troop type (milli-HP), for the "MVP" line. */
  damageBy: Record<string, number>;
}

// ------------------------------------------------------------- live state ---

export interface Building {
  id: number;
  type: BuildingId;
  typeIdx: number;
  def: BuildingDef;
  level: number;
  /** Tile coordinates and size. */
  x: number;
  y: number;
  size: number;
  /** Footprint rect in units. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  wall: boolean;
  trap: boolean;
  resource: boolean;
  /** Destruction weight (max HP), 0 for walls and traps. */
  weight: number;
  defence: DefenceDef | null;
  trapDef: TrapDef | null;
  cooldown: number;
  targetId: number;
  lockTicks: number;
  trapFireTick: number;
  /** Ticks since this building last took damage (for hit flashes in the renderer). */
  hitTick: number;
}

export interface Troop {
  id: number;
  kind: TroopId;
  kindIdx: number;
  def: TroopDef;
  level: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  flies: boolean;
  speed: number;
  range: number;
  dmgPerHit: number;
  cooldown: number;
  targetId: number;
  /** What it is hitting right now (its target, or a wall in the way); -1 when walking. */
  engageId: number;
  facing: number;
  everTargeted: boolean;
  moving: boolean;
  attackTick: number;
  hitTick: number;
}

export interface Projectile {
  id: number;
  /** 'troop' = fired at a building; 'defence' = fired at troops. */
  from: 'troop' | 'defence';
  ownerId: number;
  ownerType: string;
  fireTick: number;
  impactTick: number;
  damage: number;
  /** Building id (troop shots) or troop id (homing defence shots); -1 for ground splash shots. */
  targetId: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  splash: number;
  hitsAir: boolean;
  hitsGround: boolean;
  homing: boolean;
  /** Bonus vs resource buildings, percent. */
  resourceBonusPct: number;
}

/** Presentation-only effects produced during the last tick (never hashed). */
export type Fx =
  | { k: 'hitB'; id: number; dmg: number }
  | { k: 'hitT'; id: number; dmg: number }
  | { k: 'shot'; pid: number }
  | { k: 'impact'; x: number; y: number; splash: number; kind: string }
  | { k: 'beam'; from: number; to: number; stage: number }
  | { k: 'boom'; x: number; y: number }
  | { k: 'trap'; id: number }
  | { k: 'destroyed'; id: number }
  | { k: 'died'; id: number }
  | { k: 'deploy'; id: number }
  | { k: 'rally'; id: number }
  /** v2: Fire Dragon breath from troop `id` towards (x, y). */
  | { k: 'breath'; id: number; x: number; y: number }
  /** v2: Stone Giant fist slam at (x, y). */
  | { k: 'slam'; id: number; x: number; y: number }
  /** v2: a melee strike (sword arc) from troop `id`. */
  | { k: 'swing'; id: number };

export interface BattleState {
  input: BattleInput;
  /** Engine version these rules run under (from the input; never hashed). */
  v: number;
  /** The roster of that version. */
  roster: Partial<Record<TroopId, TroopDef>>;
  tick: number;
  rng: Sfc32;
  buildings: Building[];
  troops: Troop[];
  projectiles: Projectile[];
  /** Tile -> index of the blocking building on it (-1 = free). Walls included, traps not. */
  occ: Int16Array;
  /** Tile passability: 0 free, 1 live wall, 2 live building (see pathfinding.ts). */
  pass: Uint8Array;
  /** 1 where deploying is forbidden. */
  noDeploy: Uint8Array;
  gridW: number;
  gridH: number;
  /** Bumped whenever a blocking building is destroyed; keys the path cache. */
  layoutVersion: number;
  fields: Map<number, Int32Array>;
  /** Actions not yet applied, in order. */
  pending: Action[];
  /** Every action actually applied (the replay records the input actions). */
  applied: Action[];
  remaining: number[];
  remainingTotal: number;
  generalId: number;
  rallyUsed: boolean;
  rallyUntil: number;
  totalWeight: number;
  destroyedWeight: number;
  destructionBp: number;
  stars: number;
  citadelDestroyed: boolean;
  ended: boolean;
  endReason: EndReason | null;
  events: SimEvent[];
  fx: Fx[];
  nextId: number;
  deployed: number[];
  lost: number[];
  damageBy: number[];
}
