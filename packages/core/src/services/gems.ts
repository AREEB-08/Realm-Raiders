import { GEM_REWARDS, STARTING_GEMS } from '@realm/game-data';
import { nightOf, type GemsDTO } from '@realm/shared';
import type { Ctx } from '../ctx';
import type { GemLogDoc, ResourcesDoc } from '../types';
import { uid } from './common';

/**
 * Gems (spec F7): earned only by playing, spent only on Auto Mode. Every change lands in the
 * player's resources (the balance) and in `gemLog` (the history shown in Profile). Callers save
 * `res` afterwards, exactly as they already do for Renown and loot.
 */
export const gemsOf = (res: ResourcesDoc) => res.gems ?? STARTING_GEMS;

const utcDay = (ms: number) => nightOf(new Date(ms));

export async function grantGems(ctx: Ctx, res: ResourcesDoc, delta: number, reason: GemLogDoc['reason'], label: string, id?: string) {
  res.gems = Math.max(0, gemsOf(res) + delta);
  const at = ctx.now();
  const prev = id ? await ctx.repo.gemLog.get(id) : undefined;
  await ctx.repo.gemLog.put({
    id: id ?? uid('g_'),
    playerId: res.id,
    delta: (prev?.delta ?? 0) + delta,
    reason,
    label,
    at,
  });
  return res.gems;
}

/** +2 for the first visit of each UTC day. Returns true when it paid out. */
export async function dailyLogin(ctx: Ctx, res: ResourcesDoc) {
  const today = utcDay(ctx.now());
  if (res.gemDays?.login === today) return false;
  res.gemDays = { ...res.gemDays, login: today };
  await grantGems(ctx, res, GEM_REWARDS.dailyLogin, 'daily', 'Daily login');
  return true;
}

/** Raid rewards: +5 for the first verified raid of the UTC day, +3 for every 3-star raid. */
export async function raidGems(ctx: Ctx, res: ResourcesDoc, stars: number, target: string) {
  const out: { delta: number; label: string }[] = [];
  const today = utcDay(ctx.now());
  if (res.gemDays?.firstRaid !== today) {
    res.gemDays = { ...res.gemDays, firstRaid: today };
    await grantGems(ctx, res, GEM_REWARDS.firstRaid, 'first_raid', 'First raid today');
    out.push({ delta: GEM_REWARDS.firstRaid, label: 'First raid today' });
  }
  if (stars === 3) {
    await grantGems(ctx, res, GEM_REWARDS.threeStar, 'three_star', `3-star raid on ${target}`);
    out.push({ delta: GEM_REWARDS.threeStar, label: '3-star raid' });
  }
  return out;
}

export async function gemHistory(ctx: Ctx, playerId: string, res: ResourcesDoc): Promise<GemsDTO> {
  const rows = (await ctx.repo.gemLog.find((g) => g.playerId === playerId)).sort((a, b) => b.at - a.at);
  return {
    balance: gemsOf(res),
    history: [
      ...rows.slice(0, 30).map((g) => ({ id: g.id, delta: g.delta, label: g.label, at: g.at })),
      // The 50 every commander starts with (not a row, so old saves show it too).
      ...(rows.length < 30 ? [{ id: 'start', delta: STARTING_GEMS, label: 'Starting Gems', at: 0 }] : []),
    ],
  };
}
