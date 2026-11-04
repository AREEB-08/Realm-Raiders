import { baseHash, normalizeBase, simulate } from '@realm/battle-engine';
import { PLAN_TEMPLATES, attackRenown, lootFrom } from '@realm/game-data';
import type { TargetDTO } from '@realm/shared';
import { opponentNotes } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { armyCapacity, troopLevel } from '../economy';
import { citadelLevelOf } from '../layout';
import { expandPlan, practiceInputs } from '../plans';
import { HttpError, type IslandDoc } from '../types';
import { loadPlayer } from './common';
import { lanOf } from './lan';

/**
 * A commander in the LAN room as a target (spec F9): their *sealed* base and what their
 * treasury holds, shaped like an island so the War Room, commit and verify work unchanged.
 */
export async function friendIsland(ctx: Ctx, friendId: string, myCitadel: number): Promise<IslandDoc | null> {
  const p = await ctx.repo.players.get(friendId);
  if (!p) return null;
  const { base, res, general } = await loadPlayer(ctx, friendId);
  if (!base.sealedLayout || !base.sealedHash) return null;
  const cl = citadelLevelOf(base.sealedLayout);
  const name = general?.name ?? 'A friend';
  return {
    id: `p:${friendId}`,
    ownerPlayerId: friendId,
    npcKey: null,
    name: `${name}'s holdfast`,
    ownerName: name,
    difficulty: cl < myCitadel ? 'easy' : cl === myCitadel ? 'medium' : 'hard',
    blurb: `${name}'s sealed base — a friend on your Wi-Fi.`,
    stored: { gold: res.gold, timber: res.timber },
    layout: base.sealedLayout,
  };
}

const scoutCache = new Map<string, number>();

/**
 * The General's pick (§14.2 fallback): the highest expected reward for the risk. The Strategist
 * gives a quick read — one practice run of the opening plan — and expected Renown plus loot wins.
 */
function scoutScore(island: IslandDoc, attackerCitadel: number, capacity: number, level: number): number {
  const base = normalizeBase(island.layout);
  const key = `${baseHash(base)}|${attackerCitadel}|${capacity}|${level}`;
  const hit = scoutCache.get(key);
  if (hit !== undefined) return hit;
  const tpl = PLAN_TEMPLATES[0]!;
  const plan = expandPlan(tpl, {}, base, { capacity, troopLevel: level, generalLevel: 1 });
  const [input] = practiceInputs(base, plan.army, plan.actions, `scout:${island.id}`, 1);
  const r = simulate(input!);
  const defenderCitadel = citadelLevelOf(island.layout);
  const loot = lootFrom(island.stored);
  const renown = attackRenown(r.stars, r.destructionPct, defenderCitadel > attackerCitadel);
  const score = renown + ((loot.gold + loot.timber) * r.destructionBp) / 10000 / 100;
  scoutCache.set(key, score);
  return score;
}

export async function islandTarget(ctx: Ctx, island: IslandDoc, history: { stars: number; destructionPct: number }[]): Promise<TargetDTO> {
  const owner = island.ownerPlayerId ? await ctx.repo.players.get(island.ownerPlayerId) : undefined;
  const hash = baseHash(normalizeBase(island.layout));
  const seal = owner ? await ctx.chain.sealOf(owner.address) : null;
  const sealed = !!seal && seal.baseHash.toLowerCase() === hash.toLowerCase();
  return {
    islandId: island.id,
    name: island.name,
    ownerName: island.ownerName,
    blurb: island.blurb,
    baseHash: hash,
    sealedAt: seal ? seal.sealedAt * 1000 : null,
    sealed,
    citadelLvl: citadelLevelOf(island.layout),
    lootEst: lootFrom(island.stored),
    difficulty: island.difficulty,
    intel: opponentNotes(history, island.blurb)[0]!,
    recommended: false,
    layout: island.layout,
  };
}

/** `GET /targets` — three sealed rival islands; unsealed or mismatched ones cannot be raided. */
export async function listTargets(ctx: Ctx, playerId: string): Promise<TargetDTO[]> {
  const { base } = await loadPlayer(ctx, playerId);
  const islands = (await ctx.repo.islands.all()).filter((i) => i.ownerPlayerId !== playerId);
  const order = { easy: 0, medium: 1, hard: 2 } as const;
  islands.sort((a, b) => order[a.difficulty] - order[b.difficulty]);
  const battles = await ctx.repo.battles.find((b) => b.attackerId === playerId && b.kind === 'raid' && b.status === 'recorded');
  const out: TargetDTO[] = [];
  for (const island of islands.slice(0, 3)) {
    const history = battles
      .filter((b) => b.islandId === island.id)
      .map((b) => ({ stars: b.stars ?? 0, destructionPct: (b.destructionBp ?? 0) / 100 }));
    out.push(await islandTarget(ctx, island, history));
  }
  const cl = citadelLevelOf(base.layout);
  const cap = armyCapacity(base.layout);
  const lvl = troopLevel(base.layout);
  let best: TargetDTO | null = null;
  let bestScore = -Infinity;
  for (const t of out) {
    if (!t.sealed) continue;
    const island = islands.find((i) => i.id === t.islandId)!;
    const s = scoutScore(island, cl, cap, lvl);
    if (s > bestScore) {
      bestScore = s;
      best = t;
    }
  }
  if (best) best.recommended = true;
  // Friends in the LAN room whose base is sealed (spec F9 "Raid your friend").
  const lan = lanOf(ctx);
  for (const id of lan?.memberIds() ?? []) {
    if (id === playerId) continue;
    const isle = await friendIsland(ctx, id, cl);
    if (!isle) continue;
    const t = await islandTarget(ctx, isle, []);
    const { res } = await loadPlayer(ctx, id);
    if (res.shieldUntil > ctx.now()) {
      t.sealed = false;
      t.intel = `${isle.ownerName} is under a storm-shield.`;
    }
    out.push({ ...t, friend: true });
  }
  return out;
}

export async function targetFor(ctx: Ctx, playerId: string, islandId: string) {
  if (islandId.startsWith('p:')) {
    const friendId = islandId.slice(2);
    if (friendId === playerId) throw new HttpError(400, 'you cannot raid your own island');
    const { base } = await loadPlayer(ctx, playerId);
    const island = await friendIsland(ctx, friendId, citadelLevelOf(base.layout));
    if (!island) throw new HttpError(409, 'Your friend has not sealed a base yet.');
    const { res } = await loadPlayer(ctx, friendId);
    if (res.shieldUntil > ctx.now()) throw new HttpError(409, `${island.ownerName} is under a storm-shield.`);
    const t = await islandTarget(ctx, island, []);
    if (!t.sealed) throw new HttpError(409, 'Not sealed — cannot raid');
    return { island, target: { ...t, friend: true } };
  }
  const island = await ctx.repo.islands.get(islandId);
  if (!island) throw new HttpError(404, 'no such island');
  if (island.ownerPlayerId === playerId) throw new HttpError(400, 'you cannot raid your own island');
  const t = await islandTarget(ctx, island, []);
  if (!t.sealed) throw new HttpError(409, 'Not sealed — cannot raid');
  return { island, target: t };
}
