/**
 * Frozen, append-only id orders. The index of an id is its on-the-wire byte in the
 * canonical base encoding and in replays (§13.5). Never reorder or remove an entry;
 * append new ids at the end and bump ENGINE_VERSION.
 */
export const BUILDING_IDS = [
  'citadel',
  'goldworks',
  'treasury',
  'lumbercamp',
  'timberyard',
  'emberwell',
  'musterhall',
  'warcamp',
  'bowtower',
  'stonethrower',
  'obelisk',
  'ballista',
  'wall',
  'caltrops',
] as const;
export type BuildingId = (typeof BUILDING_IDS)[number];

/** Display names (engine v2): shield = Swordsman, longbow = Archer, ravager = Stone Giant, drake = Fire Dragon. */
export const TROOP_IDS = ['shield', 'longbow', 'sapper', 'ravager', 'drake', 'general', 'mage'] as const;
export type TroopId = (typeof TROOP_IDS)[number];

export const RESOURCE_IDS = ['gold', 'timber', 'ember'] as const;
export type ResourceId = (typeof RESOURCE_IDS)[number];

export const buildingIndex = (id: BuildingId) => BUILDING_IDS.indexOf(id);
export const troopIndex = (id: TroopId) => TROOP_IDS.indexOf(id);

export function isBuildingId(value: string): value is BuildingId {
  return (BUILDING_IDS as readonly string[]).includes(value);
}
export function isTroopId(value: string): value is TroopId {
  return (TROOP_IDS as readonly string[]).includes(value);
}
