import { baseHash, normalizeBase } from '@realm/battle-engine';
import { BUILDINGS, OFFICERS, rankFor } from '@realm/game-data';
import { RoleOutputs, type BaseDTO, type GeneralDTO, type GeneralOutput, type HomeDTO } from '@realm/shared';
import { generalBriefing } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { collect, economy, settleTimers } from '../economy';
import { citadelLevelOf } from '../layout';
import { HttpError, type BaseDoc, type GeneralDoc, type ResourcesDoc } from '../types';
import { createPlayer, loadPlayer, newBurner, pushEvent, uid } from './common';
import { dailyLogin } from './gems';
import { autoBadge } from './auto';
import { listTargets } from './targets';

export async function demoLogin(ctx: Ctx, deviceId?: string) {
  if (!ctx.cfg.allowDemoAuth) throw new HttpError(403, 'guest sign-in is disabled');
  // Play with Friends: each phone keeps its own commander on the host (by device id).
  if (deviceId) {
    const known = (await ctx.repo.players.find((p) => p.authSub === `device:${deviceId}`))[0];
    if (known) return { playerId: known.id, address: known.address, isNew: false };
  }
  const burner = newBurner();
  const player = await createPlayer(ctx, {
    authSub: deviceId ? `device:${deviceId}` : `guest:${uid()}`,
    address: burner.address,
    isGuest: true,
    burnerKey: burner.key,
  });
  return { playerId: player.id, address: player.address, isNew: true };
}

/** Upsert a player for a verified auth subject (Privy). */
export async function authLogin(ctx: Ctx, sub: string, address: `0x${string}`) {
  const existing = (await ctx.repo.players.find((p) => p.authSub === sub))[0];
  if (existing) {
    if (address && existing.address.toLowerCase() !== address.toLowerCase()) {
      existing.address = address;
      await ctx.repo.players.put(existing);
    }
    return { playerId: existing.id, address: existing.address, isNew: false };
  }
  const player = await createPlayer(ctx, { authSub: sub, address, isGuest: false, burnerKey: null });
  return { playerId: player.id, address: player.address, isNew: true };
}

export function generalDTO(g: GeneralDoc | null): GeneralDTO | null {
  if (!g) return null;
  return {
    name: g.name,
    personality: g.personality,
    faction: g.faction,
    appearance: g.appearance,
    appearanceHash: g.appearanceHash,
    agentId: g.agentId,
    agentTx: g.agentTx,
    portraitUrl: g.portrait,
    level: 1,
  };
}

export function baseDTO(base: BaseDoc): BaseDTO {
  const currentHash = baseHash(normalizeBase(base.layout));
  return {
    layout: base.layout,
    version: base.version,
    currentHash,
    sealedHash: base.sealedHash,
    sealTx: base.sealTx,
    sealedAt: base.sealedAt,
    dirty: !!base.sealedHash && base.sealedHash !== currentHash,
    timers: Object.entries(base.timers).map(([buildingId, t]) => ({ buildingId, ...t })),
    citadelLevel: citadelLevelOf(base.layout),
  };
}

/** Settle timers and persist; returns completed building names for the feed. */
export async function settle(ctx: Ctx, base: BaseDoc, res: ResourcesDoc): Promise<string[]> {
  const done = settleTimers(base, ctx.now());
  for (const id of done) {
    const b = base.layout.buildings.find((x) => x.id === id);
    if (b) pushEvent(res, { icon: 'upgrade', title: `${BUILDINGS[b.type].name} ready`, body: `Now level ${b.level}.`, at: ctx.now() }, ctx.now());
  }
  if (done.length) {
    base.version++;
    await ctx.repo.bases.put(base);
    await ctx.repo.resources.put(res);
  }
  return done;
}

export async function getHome(ctx: Ctx, playerId: string): Promise<HomeDTO> {
  const { player, base, res, general } = await loadPlayer(ctx, playerId);
  await settle(ctx, base, res);
  if (!player.npcKey && (await dailyLogin(ctx, res))) await ctx.repo.resources.put(res);
  const now = ctx.now();
  const policy = (await ctx.repo.policies.find((p) => p.playerId === playerId && p.sealed))
    .filter((p) => p.expiresAt * 1000 > now)
    .sort((a, b) => b.createdAt - a.createdAt)[0];
  const report = (await ctx.repo.reports.find((r) => r.playerId === playerId && !r.seen)).sort((a, b) => b.createdAt - a.createdAt)[0];
  const b = baseDTO(base);
  return {
    player: { id: player.id, address: player.address, isGuest: player.isGuest },
    general: generalDTO(general),
    base: b,
    economy: economy(base, res, now),
    events: res.events.slice(0, 3),
    officers: OFFICERS.map((o) => ({
      role: o.role,
      title: o.title,
      name: o.role === 'general' ? (general?.name ?? 'Your General') : o.name,
      news:
        (o.role === 'architect' && (!b.sealedHash || b.dirty || !!base.pendingPatch)) ||
        (o.role === 'night_captain' && !policy) ||
        (o.role === 'intel' && !!report),
    })),
    pendingReport: report ? { reportId: report.id, nightId: report.nightId } : null,
    rank: rankFor(res.renown),
    chainMode: ctx.chain.mode,
    activePolicy: policy ? { nightId: policy.nightId, policyHash: policy.policyHash, expiresAt: policy.expiresAt } : null,
    auto: await autoBadge(ctx, playerId),
    now,
  };
}

export async function collectBuilding(ctx: Ctx, playerId: string, buildingId: string) {
  const { base, res } = await loadPlayer(ctx, playerId);
  const amount = collect(base, res, buildingId, ctx.now());
  await ctx.repo.bases.put(base);
  await ctx.repo.resources.put(res);
  return { collected: amount, economy: economy(base, res, ctx.now()) };
}

/** The General's home briefing (§11 screen 03): greets and recommends a target. */
export async function generalBriefingTask(ctx: Ctx, playerId: string) {
  const { base, res, general } = await loadPlayer(ctx, playerId);
  const targets = await listTargets(ctx, playerId);
  const target = targets.find((t) => t.recommended) ?? null;
  const report = (await ctx.repo.reports.find((r) => r.playerId === playerId && !r.seen)).length > 0;
  const b = baseDTO(base);
  const facts = {
    general: general?.name ?? 'the General',
    personality: general?.personality ?? 'steadfast',
    gold: res.gold,
    timber: res.timber,
    renown: res.renown,
    sealed: !!b.sealedHash,
    dirty: b.dirty,
    pendingReport: report,
    targets: targets.map((t) => ({ islandId: t.islandId, name: t.name, difficulty: t.difficulty, lootEst: t.lootEst, citadel: t.citadelLvl })),
    recommendedByScouts: target?.islandId ?? null,
  };
  return ctx.agents.run<GeneralOutput>({
    role: 'general',
    task: 'briefing',
    playerId,
    facts,
    schema: RoleOutputs.general,
    fallback: () =>
      generalBriefing({
        name: general?.name ?? 'Your General',
        personality: general?.personality ?? 'steadfast',
        gold: res.gold,
        timber: res.timber,
        renown: res.renown,
        dirty: b.dirty,
        sealed: !!b.sealedHash,
        pendingReport: report,
        target,
      }),
    tools: {
      get_player_state: () => facts,
      list_targets: () => facts.targets,
      get_events: () => res.events.slice(0, 5),
      delegate: () => ({ answer: target ? `${target.name} is the best reward for the risk.` : 'No sealed targets.' }),
    },
    check: (out) =>
      out.suggestedTarget && !targets.some((t) => t.islandId === out.suggestedTarget) ? 'suggestedTarget must be a listed island' : null,
  });
}
