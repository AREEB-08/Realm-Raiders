import type { BuildingId } from '@realm/game-data';

/**
 * 3D building sprites (spec F6). The Three.js baker is loaded lazily; until it is ready (or if
 * WebGL baking fails) `bakedBuilding` returns null and the scenes keep the 2D drawings, then
 * redraw when `onBuildingArt` fires.
 */
type Baked = { canvas: HTMLCanvasElement; originX: number; originY: number; scale: number };
let baker: ((type: BuildingId, level: number, banner: string) => Baked) | null = null;
let failed = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

export function loadBuildingArt() {
  if (loading || failed) return loading;
  loading = import('../three/bake')
    .then((m) => m.loadBuildingBaker())
    .then((b) => {
      // A first bake proves WebGL works on this device before any scene relies on it.
      b('wall', 1, '#8a2f2f');
      baker = b;
      listeners.forEach((l) => l());
    })
    .catch((e) => {
      failed = true;
      console.warn('[art] 3D buildings unavailable; keeping the 2D drawings', e);
    });
  return loading;
}

export function bakedBuilding(type: BuildingId, level: number, banner: string): Baked | null {
  if (!baker) return null;
  try {
    return baker(type, level, banner);
  } catch (e) {
    console.warn('[art] building bake failed', type, level, e);
    baker = null;
    failed = true;
    return null;
  }
}

/** Called once when the 3D buildings become available. */
export function onBuildingArt(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
