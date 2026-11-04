import type { Appearance } from '@realm/shared';
import { bakeGeneralSprite } from '../three/CharacterStage';
import { gameCtl } from './controller';

const KEY = 'general-baked';
let bakedFor: string | null = null;
/** A look whose bake failed (no WebGL): not retried on every render. */
let failedFor: string | null = null;

/** Bake the player's General once per look and hand it to Phaser for battles (§12.4). */
export function registerGeneralSprite(a: Appearance, hash: string): string | null {
  const game = gameCtl.game;
  if (!game) return null;
  if (bakedFor === hash && game.textures.exists(KEY)) return KEY;
  if (failedFor === hash) return null;
  try {
    const canvas = bakeGeneralSprite(a);
    if (game.textures.exists(KEY)) game.textures.remove(KEY);
    game.textures.addCanvas(KEY, canvas);
    bakedFor = hash;
    return KEY;
  } catch (e) {
    failedFor = hash;
    console.warn('General sprite bake failed; using the default figure', e);
    return null;
  }
}
