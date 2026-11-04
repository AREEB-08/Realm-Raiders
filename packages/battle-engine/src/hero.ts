import { RALLY } from '@realm/game-data';
import type { BattleState } from './types';

/**
 * The General (ported from the reused hero deploy/ability hooks). Its ability is replaced by
 * Rally: once per battle, +25 % damage for troops within 5 tiles of the General for 120 ticks.
 */
export function rally(state: BattleState): boolean {
  if (state.rallyUsed || state.generalId < 0) return false;
  const g = state.troops[state.generalId]!;
  if (!g.alive) return false;
  state.rallyUsed = true;
  state.rallyUntil = state.tick + RALLY.ticks;
  state.events.push({ t: state.tick, k: 'rally' });
  state.fx.push({ k: 'rally', id: g.id });
  return true;
}
