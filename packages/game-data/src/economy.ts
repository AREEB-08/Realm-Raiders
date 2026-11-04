import type { BuildingId, ResourceId } from './ids';
import { BUILDINGS, scaleOutput } from './buildings';
import { upgradeCost, upgradeSeconds } from './scale';

export const STARTING_WALLET = { gold: 1500, timber: 1500, ember: 100 } as const;
/** Gems: an in-game currency earned only by playing (spec F7). Every commander starts with 50. */
export const STARTING_GEMS = 50;
/** How Gems are earned (spec F7). There is no other source: Gems can't be bought. */
export const GEM_REWARDS = { dailyLogin: 2, firstRaid: 5, threeStar: 3, badge: 10, duelWin: 5 } as const;

/** Auto Mode (spec F8): 2 Gems per 30-minute block, charged at the start of each block. */
export const AUTO_GEMS_PER_BLOCK = 2;
export const AUTO_BLOCK_MINUTES = 30;
export const AUTO_DURATIONS = [30, 60, 120, 240, 480] as const;
export type AutoMinutes = (typeof AUTO_DURATIONS)[number];
/** The officers act on a fixed beat, so a session (and its catch-up) always runs the same steps. */
export const AUTO_BEAT_MINUTES = 5;
export const autoCost = (minutes: number) => Math.ceil(minutes / AUTO_BLOCK_MINUTES) * AUTO_GEMS_PER_BLOCK;
/** The storm-shield the Night Captain raises after a heavy loss lasts this long. */
export const SHIELD_HOURS = 4;
export const BUILDERS = 2;

/**
 * Demo time compression for production: 1 real minute = PRODUCTION_SPEED game minutes.
 * At 60, a level-1 Goldworks (+200/h) visibly ticks up by ~3 per second.
 */
export const PRODUCTION_SPEED = 60;
/** A producer holds at most this many (game) hours of output before it must be collected. */
export const PRODUCER_HOURS_CAP = 2;

export function buildCost(id: BuildingId, level: number) {
  const def = BUILDINGS[id];
  return { amount: upgradeCost(def.cost.base, level), resource: def.cost.resource };
}

export function buildSeconds(level: number) {
  return upgradeSeconds(level);
}

/** Per-real-second output of a producer (fractional; callers floor when crediting). */
export function productionPerSecond(id: BuildingId, level: number): number {
  const p = BUILDINGS[id].produces;
  if (!p) return 0;
  return (scaleOutput(p.perHourL1, level) * PRODUCTION_SPEED) / 3600;
}

export function producerCap(id: BuildingId, level: number): number {
  const p = BUILDINGS[id].produces;
  if (!p) return 0;
  return scaleOutput(p.perHourL1, level) * PRODUCER_HOURS_CAP;
}

export function storageCapacity(id: BuildingId, level: number): number {
  const s = BUILDINGS[id].stores;
  return s ? scaleOutput(s.capacityL1, level) : 0;
}

/** Base capacity that the Citadel provides by itself for each resource. */
export function citadelCapacity(resource: ResourceId, citadelLevel: number): number {
  if (resource === 'ember') return 300 * citadelLevel;
  return 1500 * citadelLevel;
}

/** War Camp: 30 housing at L1, +10 per level (room for a Fire Dragon and its escort); camps add up. */
export const warCampCapacity = (level: number) => 30 + 10 * (Math.max(1, level) - 1);

/** Renown for an attack (§10.7). */
export function attackRenown(stars: number, destructionPct: number, targetCitadelHigher: boolean) {
  return stars * 10 + Math.floor(destructionPct / 10) + (targetCitadelHigher ? 5 : 0);
}

/** Renown for a defence (§10.7). */
export function defenceRenown(attackerStars: number) {
  return attackerStars <= 1 ? 8 : -(attackerStars * 4);
}

export const LOOT_PCT = 20;
export const LOOT_CAP = 2000;
export function lootFrom(stored: { gold: number; timber: number }) {
  return {
    gold: Math.min(LOOT_CAP, Math.floor((stored.gold * LOOT_PCT) / 100)),
    timber: Math.min(LOOT_CAP, Math.floor((stored.timber * LOOT_PCT) / 100)),
  };
}

export const RANKS = [
  { name: 'Squire', min: 0 },
  { name: 'Knight', min: 100 },
  { name: 'Banneret', min: 300 },
  { name: 'Warden', min: 700 },
  { name: 'High Marshal', min: 1500 },
] as const;

export function rankFor(renown: number) {
  let rank: (typeof RANKS)[number] = RANKS[0];
  for (const r of RANKS) if (renown >= r.min) rank = r;
  const next = RANKS.find((r) => r.min > renown);
  return { name: rank.name, min: rank.min, next: next ? { name: next.name, min: next.min } : null };
}

export const BADGES = [
  { id: 1, key: 'first_seal', name: 'First Seal', desc: 'Sealed a base in the Ledger.' },
  { id: 2, key: 'first_raid', name: 'First Raid', desc: 'Won a verified raid.' },
  { id: 3, key: 'three_star', name: 'Three-Star', desc: 'Razed a holdfast completely.' },
  { id: 4, key: 'night_watch', name: 'Night Watch', desc: 'Won 3 defences on autopilot.' },
  { id: 6, key: 'architects_pupil', name: "Architect's Pupil", desc: 'Applied an Architect fix.' },
] as const;
export type BadgeKey = (typeof BADGES)[number]['key'];
export const badgeId = (key: BadgeKey) => BADGES.find((b) => b.key === key)!.id;
