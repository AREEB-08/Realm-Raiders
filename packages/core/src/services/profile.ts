import { BADGES, rankFor } from '@realm/game-data';
import type { ProfileDTO } from '@realm/shared';
import { generalProfileLine } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { loadPlayer } from './common';
import { battleDTO } from './battle';
import { profileLineTask } from './general';
import { generalDTO } from './home';

/** Chain reads on the Profile wait at most this long; the cached values answer after that. */
const CHAIN_READ_MS = 2_500;

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * `GET /profile/:playerId` — identity, reputation and badges, read from the chain where possible.
 * Answers fast: the two chain reads run in parallel with a timeout (cached values otherwise), and
 * the General's AI line is NOT awaited here — the field-manual line answers now and the phone asks
 * for the AI line separately (`POST /agents/general/profile`). It used to wait 3–5 s for both.
 */
export async function getProfile(ctx: Ctx, playerId: string): Promise<ProfileDTO> {
  const { player, res, general } = await loadPlayer(ctx, playerId);
  const [badgeRead, repRead] = await Promise.allSettled([
    within(ctx.chain.badgesOf(player.address), CHAIN_READ_MS),
    general?.agentId ? within(ctx.chain.reputationOf(general.agentId), CHAIN_READ_MS) : Promise.resolve({ count: 0, average: 0 }),
  ]);
  const badgeIds = badgeRead.status === 'fulfilled' ? badgeRead.value : res.badges;
  const reputation =
    repRead.status === 'fulfilled'
      ? { ...repRead.value, source: 'chain' as const }
      : { count: 0, average: 0, source: 'cached' as const };
  for (const r of [badgeRead, repRead]) if (r.status === 'rejected') ctx.log('profile chain read failed', (r.reason as Error).message);
  const battles = (await ctx.repo.battles.find((b) => b.attackerId === playerId || b.defenderId === playerId))
    .filter((b) => b.status !== 'committed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 12);
  const line = generalProfileLine(general?.name ?? 'The General', res.stats.raidsWon, res.stats.raidsLost, res.renown);
  return {
    player: { id: player.id, address: player.address },
    general: generalDTO(general),
    rank: rankFor(res.renown),
    renown: res.renown,
    record: {
      raidsWon: res.stats.raidsWon,
      raidsLost: res.stats.raidsLost,
      defencesWon: res.stats.defWon,
      defencesLost: res.stats.defLost,
    },
    badges: BADGES.map((b) => ({ id: b.id, name: b.name, desc: b.desc, earned: badgeIds.includes(b.id) })),
    reputation,
    battles: battles.map(battleDTO),
    line: line.greeting,
    agent: { fallback: true, latencyMs: 0 },
    chainMode: ctx.chain.mode,
    contracts: ctx.chain.contracts,
  };
}

/** The General's own Profile line from the AI officer (asked for after the page is on screen). */
export async function profileLine(ctx: Ctx, playerId: string) {
  const { res } = await loadPlayer(ctx, playerId);
  return profileLineTask(ctx, playerId, res.stats.raidsWon, res.stats.raidsLost, res.renown);
}
