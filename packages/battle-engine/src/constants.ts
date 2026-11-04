/**
 * Bump on ANY rule or number change that affects combat. Stored in every replay.
 * v1: the launch roster (frozen; every replay recorded before the troop update).
 * v2: Swordsman / Archer / Stone Giant / Ember Mage / Fire Dragon, per-hit damage, ground-only
 *     Rune Obelisk (spec F4). New battles are v2.
 */
export const ENGINE_VERSION = 2;
/** Every version this engine can still re-simulate bit-identically. */
export const SUPPORTED_ENGINE_VERSIONS: readonly number[] = [1, 2];
/** 50 ms per tick (the same dt as the reused fixed-step render loop). */
export const TICK_HZ = 20;
/** 90 s battles. */
export const MAX_TICKS = 1800;
/** 1 tile = 1000 units; positions are integers. */
export const UNIT = 1000;
/** Q16.16 for rates, where a rate needs a fraction. */
export const FP_SHIFT = 16;
/** HP is stored in milli-HP so per-tick damage stays integral. */
export const MILLI = 1000;
/** Extra path cost for walking through a wall (it must be broken first), in path cost units (10 = 1 tile). */
export const WALL_PATH_PENALTY = 250;
/** Ground troops closer than this push apart (units). */
export const SEPARATION = 350;
/** Replay format version (§13.5). */
export const REPLAY_FORMAT = 1;
export const REPLAY_MAGIC = [0x52, 0x52, 0x50, 0x4c] as const; // "RRPL"
/** Hard bounds for replays (cf. the reused replay validator). */
export const MAX_ACTIONS = 4000;
export const MAX_REPLAY_BYTES = 512 * 1024;
