import type { TroopId } from '@realm/game-data';
import { troopArt } from '../game/baked';
import { gameCtl } from '../game/controller';

const cache = new Map<string, string>();

/**
 * A portrait of a troop for cards and the battle bar: the first idle frame of its baked 3D sprite
 * sheet, trimmed to the figure. Null until the army is baked (callers fall back to an icon).
 */
export function troopThumb(kind: TroopId): string | null {
  const art = troopArt(kind);
  const game = gameCtl.game;
  if (!art || !game) return null;
  const hit = cache.get(art.key);
  if (hit) return hit;
  try {
    const src = game.textures.get(art.key).getSourceImage() as CanvasImageSource;
    const s = art.size;
    // The figure stands in the lower middle of its cell; keep that part, square.
    const crop = Math.round(s * 0.86);
    const sx = Math.round((s - crop) / 2);
    const sy = Math.round(s * 0.0);
    const c = document.createElement('canvas');
    c.width = c.height = 96;
    c.getContext('2d')!.drawImage(src, sx, sy, crop, crop, 0, 0, 96, 96);
    const url = c.toDataURL('image/png');
    cache.set(art.key, url);
    return url;
  } catch {
    return null;
  }
}
