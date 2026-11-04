import { scaleOutput } from '@realm/game-data';
import { TICK_HZ, MILLI } from '../constants';
import type { Building } from '../types';

/**
 * Rune Obelisk damage ramp (ported from the reused 3-stage lock-time ramp): the beam burns
 * hotter the longer it stays on one target. Returns this tick's damage in milli-HP and the stage.
 */
export function obeliskTick(b: Building): { dmg: number; stage: number } {
  const def = b.defence!;
  const ramp = def.rampDps!;
  const switches = def.rampSwitchTicks!;
  const stage = b.lockTicks < switches[0] ? 0 : b.lockTicks < switches[1] ? 1 : 2;
  const dps = scaleOutput(ramp[stage]!, b.level);
  return { dmg: Math.trunc((dps * MILLI) / TICK_HZ), stage };
}
