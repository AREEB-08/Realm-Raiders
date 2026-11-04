import type { BuildingId } from '@realm/game-data';
import { FACTION_BANNERS, paintBuilding } from '../game/art';
import { bakedBuilding } from '../game/bakedBuildings';

const cache = new Map<string, string>();

/** A picture of a building for the Shop: the 3D sprite when it's ready, else the 2D drawing. */
export function buildingThumb(type: BuildingId, faction = 'thornmarch', level = 1): string {
  const banner = FACTION_BANNERS[faction] ?? FACTION_BANNERS.thornmarch!;
  const b3 = bakedBuilding(type, level, banner);
  const key = `${type}:${level}:${banner}:${b3 ? '3d' : '2d'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const url = (b3?.canvas ?? paintBuilding(type, level, banner).canvas).toDataURL('image/png');
    cache.set(key, url);
    return url;
  } catch {
    return '';
  }
}
