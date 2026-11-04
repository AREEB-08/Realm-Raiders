import {
  base64ToBytes,
  ENGINE_VERSION,
  fromHex,
  keccak,
  normalizeBase,
  replayHash as hashReplay,
  resultHash,
  simulate,
  verifyReplay,
  type BattleInput,
} from '@realm/battle-engine';
import {
  RoleOutputs,
  randomHex32,
  FEEDBACK_TAG1,
  type BattleCommitDTO,
  type BattleDTO,
  type BattleSubmitDTO,
  type Hex,
  type IntelOutput,
  type StrategistOutput,
} from '@realm/shared';
import { intelReport, opponentNotes, strategistCommentary } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { clampToCaps } from '../economy';
import { citadelLevelOf } from '../layout';
import { armyCost } from '../plans';
import { HttpError, type BattleDoc } from '../types';
import { awardBadge, chainBattleId, loadPlayer, pushEvent, uid } from './common';
import { raidGems } from './gems';
import { NO_HOST, lanOf } from './lan';
import { targetFor } from './targets';

/** `POST /battle/commit` — pay for the army, then lock the seed on-chain (commit → reveal). */
export async function commitBattle(
  ctx: Ctx,
  playerId: string,
  warRoomId: string,
  planId: string,
  attackerNonce?: string,
  duelId?: string,
): Promise<BattleCommitDTO> {
  const { player, base, res } = await loadPlayer(ctx, playerId);
  const room = await ctx.repo.warRooms.get(warRoomId);
  if (!room || room.playerId !== playerId) throw new HttpError(404, 'no such war room');
  // Live Duel: the seed was locked once for both commanders when the duel started.
  const lan = lanOf(ctx);
  if (duelId && !lan) throw new HttpError(409, NO_HOST);
  const duel = duelId ? await lan!.duelCommit(playerId, duelId) : null;
  if (duel && room.targetIslandId !== `p:${duel.foe.playerId}`) throw new HttpError(409, "That War Room is not against your duel opponent.");
  const plan = room.plans.find((p) => p.planId === planId);
  if (!plan) throw new HttpError(404, 'no such plan');
  const { island, target } = await targetFor(ctx, playerId, room.targetIslandId);
  const owner = await ctx.repo.players.get(island.ownerPlayerId!);
  if (!owner) throw new HttpError(409, 'target has no owner');
  const cost = armyCost(plan.army);
  if (res.timber < cost.timber || res.ember < cost.ember)
    throw new HttpError(402, `The army costs ${cost.timber} timber and ${cost.ember} ember.`);
  res.timber -= cost.timber;
  res.ember -= cost.ember;
  await ctx.repo.resources.put(res);

  const id = uid('b_');
  const onChainId = chainBattleId(id);
  const secret = randomHex32();
  const nonce = (attackerNonce as Hex | undefined) ?? randomHex32();
  try {
    let commitTx, revealTx, seed;
    if (duel) {
      commitTx = revealTx = duel.seedTx;
      seed = duel.seed;
    } else {
      commitTx = await ctx.chain.commitBattle({
        battleId: onChainId,
        attacker: player.address,
        defender: owner.address,
        defenderBaseHash: target.baseHash,
        secretHash: keccak(fromHex(secret)),
        attackerNonce: nonce,
      });
      ({ tx: revealTx, seed } = await ctx.chain.revealSeed(onChainId, secret));
    }
    const sealedBase = normalizeBase(island.layout);
    const doc: BattleDoc = {
      id,
      kind: duel ? 'duel' : 'raid',
      duelId: duelId ?? null,
      chainBattleId: duel ? duel.duel.chainId : onChainId,
      attackerId: playerId,
      attackerAddress: player.address,
      attackerName: (await ctx.repo.generals.get(playerId))?.name ?? 'Raider',
      defenderId: owner.id,
      defenderAddress: owner.address,
      defenderName: island.name,
      islandId: island.id,
      planId: plan.planId,
      seed,
      secret,
      attackerNonce: nonce,
      commitTx,
      revealTx,
      baseHash: target.baseHash,
      base: sealedBase,
      army: plan.army,
      engineVersion: ENGINE_VERSION,
      attackerCitadel: citadelLevelOf(base.layout),
      defenderStored: island.stored,
      replay: null,
      replayHash: null,
      stars: null,
      destructionBp: null,
      renown: null,
      loot: null,
      resultTx: null,
      feedbackTx: null,
      status: 'committed',
      report: null,
      createdAt: ctx.now(),
    };
    await ctx.repo.battles.put(doc);
    lan?.raidStarted(doc);
    if (duel) await lan!.duelCommitted(duelId!, playerId, id);
    return {
      battleId: id,
      live: island.id.startsWith('p:'),
      duelId: duelId ?? undefined,
      seed,
      commitTx,
      revealTx,
      chainMode: ctx.chain.mode,
      base: sealedBase,
      baseHash: target.baseHash,
      army: plan.army,
      plan,
      targetName: island.name,
      attackerCitadel: doc.attackerCitadel,
      defenderStored: island.stored,
      engineVersion: ENGINE_VERSION,
    };
  } catch (e) {
    // Refund the army if the seed could not be locked.
    res.timber += cost.timber;
    res.ember += cost.ember;
    await ctx.repo.resources.put(res);
    throw new HttpError(503, `Could not lock the seed: ${(e as Error).message}`);
  }
}

function sameArmy(a: BattleInput['army'], b: BattleInput['army']) {
  const key = (x: BattleInput['army']) =>
    x.troops
      .filter((e) => e.count > 0)
      .map((e) => `${e.troop}:${e.level}:${e.count}`)
      .sort()
      .join(',');
  return key(a) === key(b);
}

/** Destruction % over time, for the Intel report. */
function timeline(input: BattleInput) {
  const pct = new Map<number, number>();
  let last = 0;
  simulate(input, (s) => {
    last = s.destructionBp / 100;
    if (s.tick === 600 || s.tick === 1200 || s.tick === 1799) pct.set(s.tick, last);
  });
  return (t: number) => pct.get(t) ?? last;
}

export async function intelForBattle(ctx: Ctx, playerId: string, b: BattleDoc, input: BattleInput, result: ReturnType<typeof simulate>) {
  const history = (await ctx.repo.battles.find((x) => x.attackerId === playerId && x.islandId === b.islandId && x.status === 'recorded')).map(
    (x) => ({ stars: x.stars ?? 0, destructionPct: (x.destructionBp ?? 0) / 100 }),
  );
  const island = b.islandId ? await ctx.repo.islands.get(b.islandId) : undefined;
  const notes = opponentNotes(history, island?.blurb ?? 'a holdfast');
  const at = timeline(input);
  return ctx.agents.run<IntelOutput>({
    role: 'intel',
    task: 'report',
    playerId,
    facts: {
      target: b.defenderName,
      stars: result.stars,
      destructionPct: result.destructionPct,
      endReason: result.endReason,
      events: result.events.filter((e) => e.k !== 'deploy').slice(0, 40),
      razedAt: { '0:30': at(600), '1:00': at(1200), '1:30': at(1799) },
      damageByTroop: result.damageBy,
      lost: result.lost,
    },
    schema: RoleOutputs.intel,
    fallback: () => intelReport(result, at, b.defenderName, notes),
    tools: {
      get_battle_report: () => ({ stars: result.stars, destructionPct: result.destructionPct, endReason: result.endReason }),
      get_replay_events: () => result.events.slice(0, 60),
      get_opponent_history: () => history,
    },
  });
}

/** `POST /battle/:id/submit` — re-simulate the replay; only a matching one earns Renown. */
export async function submitBattle(ctx: Ctx, playerId: string, battleId: string, replayB64: string): Promise<BattleSubmitDTO> {
  const b = await ctx.repo.battles.get(battleId);
  if (!b || b.attackerId !== playerId) throw new HttpError(404, 'no such battle');
  if (b.status !== 'committed') throw new HttpError(409, `battle already ${b.status}`);
  const { player, base, res } = await loadPlayer(ctx, playerId);
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(replayB64);
  } catch {
    throw new HttpError(400, 'replay is not base64');
  }
  const report = verifyReplay(
    bytes,
    { seed: b.seed, baseHash: b.baseHash },
    { attackerCitadel: b.attackerCitadel, defenderStored: b.defenderStored },
  );
  const reasons = [...report.reasons];
  if (report.decoded && !sameArmy(report.decoded.army, b.army)) reasons.push('army differs from the committed army');
  // The rules are fixed at commit: a replay under any other engine version is not this battle
  // (it would score an old-rules army against a new-rules seed).
  const committedFor = b.engineVersion ?? 1;
  if (report.decoded && report.decoded.engineVersion !== committedFor)
    reasons.push(`replay uses engine v${report.decoded.engineVersion}; this battle was committed for v${committedFor}`);
  const rh = hashReplay(bytes);
  b.replay = replayB64;
  b.replayHash = rh;
  const empty = { headline: 'Replay rejected', keyMoments: [], opponentNotes: [] };
  if (reasons.length || !report.result) {
    b.status = 'rejected';
    b.report = empty;
    res.stats.raidsLost++;
    await ctx.repo.battles.put(b);
    await ctx.repo.resources.put(res);
    return {
      battleId,
      verified: false,
      reasons,
      result: null,
      replayHash: rh,
      resultHash: null,
      seedTx: b.revealTx,
      resultTx: null,
      feedbackTx: null,
      badges: [],
      report: empty,
      agent: { fallback: true, latencyMs: 0 },
    };
  }
  const r = report.result;
  if (b.kind === 'duel') return duelSubmitted(ctx, b, r, rh);
  b.status = 'verified';
  b.stars = r.stars;
  b.destructionBp = r.destructionBp;
  b.renown = r.renown;
  b.loot = r.loot;
  res.renown += r.renown;
  res.gold += r.loot.gold;
  res.timber += r.loot.timber;
  clampToCaps(res, base.layout);
  if (r.stars > 0) res.stats.raidsWon++;
  else res.stats.raidsLost++;
  try {
    b.resultTx = await ctx.chain.recordResult(b.chainBattleId, rh, r.stars, r.destructionBp, r.renown);
    b.status = 'recorded';
  } catch (e) {
    ctx.log('recordResult failed', (e as Error).message);
  }
  const general = await ctx.repo.generals.get(playerId);
  if (general?.agentId) {
    try {
      const value = Math.min(100, r.stars * 30 + Math.floor(r.destructionPct / 10));
      b.feedbackTx = await ctx.chain.giveFeedback(general.agentId, value, `${ctx.cfg.publicBaseUrl}/battle/${battleId}/replay`, rh);
    } catch (e) {
      ctx.log('giveFeedback failed', (e as Error).message);
    }
  }
  const badges = [];
  if (r.stars >= 1) badges.push(await awardBadge(ctx, player, res, 'first_raid'));
  if (r.stars === 3) badges.push(await awardBadge(ctx, player, res, 'three_star'));
  const gems = await raidGems(ctx, res, r.stars, b.defenderName);
  // Raid a friend: the loot really leaves their treasury, and they hear about it.
  if (b.islandId?.startsWith('p:')) {
    const def = await loadPlayer(ctx, b.defenderId);
    def.res.gold = Math.max(0, def.res.gold - r.loot.gold);
    def.res.timber = Math.max(0, def.res.timber - r.loot.timber);
    if (r.stars >= 2) def.res.stats.defLost++;
    else def.res.stats.defWon++;
    pushEvent(
      def.res,
      { icon: 'raid', title: `${b.attackerName} raided you: ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`, body: `${Math.round(r.destructionPct)}% razed · −${r.loot.gold} gold, −${r.loot.timber} timber`, at: ctx.now(), tx: b.resultTx },
      ctx.now(),
    );
    await ctx.repo.resources.put(def.res);
  }
  const intel = await intelForBattle(ctx, playerId, b, report.decoded!, r);
  b.report = intel.output;
  pushEvent(
    res,
    {
      icon: 'raid',
      title: `Raid on ${b.defenderName}: ${'★'.repeat(r.stars)}${'☆'.repeat(3 - r.stars)}`,
      body: `${Math.round(r.destructionPct)}% razed · +${r.renown} Renown · +${r.loot.gold} gold, +${r.loot.timber} timber`,
      at: ctx.now(),
      tx: b.resultTx,
    },
    ctx.now(),
  );
  await ctx.repo.battles.put(b);
  await ctx.repo.resources.put(res);
  lanOf(ctx)?.raidEnded(b);
  return {
    battleId,
    verified: true,
    reasons: [],
    result: {
      stars: r.stars,
      destructionPct: r.destructionPct,
      destructionBp: r.destructionBp,
      renown: r.renown,
      loot: r.loot,
    },
    replayHash: rh,
    resultHash: resultHash(rh, r.stars, r.destructionBp, r.renown),
    seedTx: b.revealTx,
    resultTx: b.resultTx,
    feedbackTx: b.feedbackTx,
    badges: badges.filter((x): x is NonNullable<typeof x> => !!x),
    gems,
    report: intel.output,
    agent: { fallback: intel.fallback, latencyMs: intel.latencyMs },
  };
}

/** A duel replay: verified like any raid, but no loot or Renown — the duel decides (lan.ts). */
async function duelSubmitted(ctx: Ctx, b: BattleDoc, r: NonNullable<ReturnType<typeof verifyReplay>['result']>, rh: Hex): Promise<BattleSubmitDTO> {
  b.status = 'verified';
  b.stars = r.stars;
  b.destructionBp = r.destructionBp;
  b.renown = 0;
  b.loot = { gold: 0, timber: 0 };
  b.report = { headline: `Duel replay verified: ${r.stars}★, ${Math.round(r.destructionPct)}%`, keyMoments: [], opponentNotes: [] };
  await ctx.repo.battles.put(b);
  const lan = lanOf(ctx);
  lan?.raidEnded(b);
  const duel = lan && b.duelId ? await lan.duelSubmitted(b.duelId, b.attackerId, { stars: r.stars, bp: r.destructionBp, ticks: r.ticks, replayHash: rh }) : undefined;
  return {
    battleId: b.id,
    verified: true,
    reasons: [],
    result: { stars: r.stars, destructionPct: r.destructionPct, destructionBp: r.destructionBp, renown: 0, loot: { gold: 0, timber: 0 } },
    replayHash: rh,
    resultHash: null,
    seedTx: b.revealTx,
    resultTx: null,
    feedbackTx: null,
    badges: [],
    report: b.report,
    agent: { fallback: true, latencyMs: 0 },
    duel,
  };
}

export function battleDTO(b: BattleDoc): BattleDTO {
  return {
    battleId: b.id,
    kind: b.kind,
    status: b.status,
    attacker: b.attackerName,
    defender: b.defenderName,
    seed: b.seed,
    baseHash: b.baseHash,
    replayHash: b.replayHash,
    stars: b.stars,
    destructionBp: b.destructionBp,
    renown: b.renown,
    commitTx: b.commitTx,
    resultTx: b.resultTx,
    createdAt: b.createdAt,
  };
}

export async function getBattle(ctx: Ctx, battleId: string) {
  const b = await ctx.repo.battles.get(battleId);
  if (!b) throw new HttpError(404, 'no such battle');
  return { ...battleDTO(b), report: b.report, loot: b.loot, tag: FEEDBACK_TAG1 };
}

export async function getReplay(ctx: Ctx, battleId: string) {
  const b = await ctx.repo.battles.get(battleId);
  if (!b || !b.replay) throw new HttpError(404, 'no replay');
  return { battleId, replay: b.replay, replayHash: b.replayHash, seed: b.seed, baseHash: b.baseHash, status: b.status };
}

/** Live-battle "thinking out loud" (≤ 25 words, every 5 s while the battle runs). */
export async function commentary(ctx: Ctx, playerId: string, snap: { tick: number; destructionPct: number; stars: number; alive: number; lastEvent?: string }) {
  return ctx.agents.run<StrategistOutput>({
    role: 'strategist',
    task: 'commentary',
    playerId,
    facts: snap,
    schema: RoleOutputs.strategist,
    fallback: () => strategistCommentary(snap),
    check: (o) => ((o.thoughts[0] ?? '').split(/\s+/).length > 25 ? 'too long' : null),
  });
}
