import type { Building, Troop } from '../types';

/**
 * Stonethrower shot (ported from the reused mortar rules): aimed at where the target stands when
 * it fires, lands after a constant flight, splashes every ground troop in the radius. It cannot
 * hit inside its minimum range (handled by targeting).
 */
export function stonethrowerAim(_b: Building, target: Troop) {
  return { x: target.x, y: target.y, homing: false };
}
