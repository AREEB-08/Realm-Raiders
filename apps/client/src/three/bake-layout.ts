/**
 * Layout of the baked sprite atlases, shared by the baker (Three.js) and the battle renderer
 * (Phaser) without pulling Three.js into the game bundle.
 */
export type Anim = 'idle' | 'walk' | 'attack' | 'death';
export const ANIMS: readonly [Anim, number][] = [
  ['idle', 4],
  ['walk', 8],
  ['attack', 6],
  ['death', 4],
];

/** Tile-space facing angle (degrees, 0 = +x) of each baked row: S, SE, W, NW, N. */
export const BAKED_DIRS = [45, 0, 135, 180, 225] as const;
/** For the 8 screen directions (θ = d × 45°): which baked row, and whether to mirror it. */
export const DIR8: readonly { row: number; flip: boolean }[] = [
  { row: 1, flip: false }, // 0°   SE
  { row: 0, flip: false }, // 45°  S
  { row: 1, flip: true }, // 90°  SW = mirrored SE
  { row: 2, flip: false }, // 135° W
  { row: 3, flip: false }, // 180° NW
  { row: 4, flip: false }, // 225° N
  { row: 3, flip: true }, // 270° NE = mirrored NW
  { row: 2, flip: true }, // 315° E  = mirrored W
];

/** Column of the first frame of each animation. */
export const ANIM_START: Record<Anim, number> = (() => {
  const out = {} as Record<Anim, number>;
  let c = 0;
  for (const [name, n] of ANIMS) {
    out[name] = c;
    c += n;
  }
  return out;
})();
export const ANIM_COLS = ANIMS.reduce((n, [, k]) => n + k, 0);
/** Feet sit this far down a cell. */
export const ANCHOR_Y = 0.78;
/** The game's iso scale: a 1-tile step along an axis spans 32 px across the screen, i.e. 32·√2 px per world unit. */
export const GAME_PX_PER_TILE = 32 * Math.SQRT2;

/** 8-way screen direction (index into DIR8) from the engine's 16-direction facing index. */
export const dir8Of = (facing16: number) => ((facing16 + 1) >> 1) & 7;
