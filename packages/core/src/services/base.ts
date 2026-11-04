import { baseHash, normalizeBase } from '@realm/battle-engine';
import {
  BUILDERS,
  BUILDINGS,
  buildCost,
  buildSeconds,
  isBuildingId,
  limitFor,
  maxLevelFor,
  type BuildingId,
  type Layout,
} from '@realm/game-data';
import { RoleOutputs, type ArchitectOutput, type ArchitectReview, type Hex } from '@realm/shared';
import { architectTips } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { economy } from '../economy';
import {
  analyzeLayout,
  applyMoves,
  canPlace,
  citadelLevelOf,
  heuristicPatch,
  layoutErrors,
  occupancy,
  sameBuildings,
  validatePatch,
} from '../layout';
import { planWalls } from '../walls';
import { HttpError, type BaseDoc, type ResourcesDoc } from '../types';
import { awardBadge, loadPlayer, pushEvent, signerOf } from './common';
import { baseDTO, settle } from './home';

function charge(res: ResourcesDoc, cost: { amount: number; resource: 'gold' | 'timber' | 'ember' }) {
  if (res[cost.resource] < cost.amount)
    throw new HttpError(402, `Not enough ${cost.resource}: need ${cost.amount}, have ${res[cost.resource]}.`);
  res[cost.resource] -= cost.amount;
}

function nextId(base: BaseDoc, type: BuildingId) {
  return `${type}-${base.nextSeq++}`;
}

async function saveAll(ctx: Ctx, base: BaseDoc, res: ResourcesDoc) {
  base.version++;
  await ctx.repo.bases.put(base);
  await ctx.repo.resources.put(res);
  return { base: baseDTO(base), economy: economy(base, res, ctx.now()) };
}

/** `PUT /base/layout` — moves only: same buildings, new positions, all rules hold. */
export async function putLayout(ctx: Ctx, playerId: string, layout: Layout) {
  const { base, res } = await loadPlayer(ctx, playerId);
  if (!sameBuildings(base.layout, layout)) return { ok: false, errors: ['Layout must keep the same buildings (moves only).'] };
  const errors = layoutErrors(layout);
  if (errors.length) return { ok: false, errors };
  base.layout = layout;
  const out = await saveAll(ctx, base, res);
  return { ok: true, errors: [], ...out };
}

export async function build(ctx: Ctx, playerId: string, type: string, x: number, y: number) {
  if (!isBuildingId(type)) throw new HttpError(400, 'unknown building');
  const { base, res } = await loadPlayer(ctx, playerId);
  await settle(ctx, base, res);
  const cl = citadelLevelOf(base.layout);
  const def = BUILDINGS[type];
  const count = base.layout.buildings.filter((b) => b.type === type).length;
  if (count >= limitFor(type, cl)) throw new HttpError(409, `${def.name}: ${count}/${limitFor(type, cl)} built for Citadel ${cl}.`);
  if (type !== 'wall' && Object.keys(base.timers).length >= BUILDERS) throw new HttpError(409, 'Both Masons are busy.');
  if (!canPlace(occupancy(base.layout), type, x, y)) throw new HttpError(409, 'That ground is taken or off the island.');
  charge(res, buildCost(type, 1));
  const id = nextId(base, type);
  base.layout.buildings.push({ id, type, level: 1, x, y });
  base.collectedAt[id] = ctx.now();
  if (type !== 'wall' && type !== 'caltrops') base.timers[id] = { toLevel: 1, readyAt: ctx.now() + buildSeconds(1) * 1000 };
  return { id, ...(await saveAll(ctx, base, res)) };
}

/**
 * Wall line (spec F5): the phone shows a ghost line from `planWalls` and sends the tiles the player
 * confirmed. The server settles production first, re-runs the same plan and places all of them or
 * none, with the exact reason when it can't ("Not enough Gold", "Something is already here", …).
 */
export async function buildWalls(ctx: Ctx, playerId: string, tiles: { x: number; y: number }[]) {
  const { base, res } = await loadPlayer(ctx, playerId);
  await settle(ctx, base, res);
  const plan = planWalls(base.layout, res, tiles);
  const bad = plan.tiles.find((t) => t.state !== 'ok');
  if (bad) throw new HttpError(bad.state === 'short' ? 402 : 409, plan.problem!);
  if (!plan.placeable.length) throw new HttpError(400, 'Tap and drag to draw a wall line.');
  charge(res, { amount: plan.cost, resource: plan.resource });
  for (const t of plan.placeable) base.layout.buildings.push({ id: nextId(base, 'wall'), type: 'wall', level: 1, x: t.x, y: t.y });
  return { placed: plan.placeable.length, cost: plan.cost, ...(await saveAll(ctx, base, res)) };
}

export async function upgrade(ctx: Ctx, playerId: string, buildingId: string) {
  const { base, res } = await loadPlayer(ctx, playerId);
  await settle(ctx, base, res);
  const b = base.layout.buildings.find((x) => x.id === buildingId);
  if (!b) throw new HttpError(404, 'no such building');
  if (base.timers[buildingId]) throw new HttpError(409, 'Already being worked on.');
  const cl = citadelLevelOf(base.layout);
  const cap = maxLevelFor(b.type, cl);
  if (b.level >= cap)
    throw new HttpError(409, b.level >= BUILDINGS[b.type].maxLevel ? 'Already at max level.' : `Raise the Citadel to go past level ${cap}.`);
  const walls = b.type === 'wall';
  if (!walls && Object.keys(base.timers).length >= BUILDERS) throw new HttpError(409, 'Both Masons are busy.');
  charge(res, buildCost(b.type, b.level + 1));
  if (walls) b.level++;
  else base.timers[buildingId] = { toLevel: b.level + 1, readyAt: ctx.now() + buildSeconds(b.level + 1) * 1000 };
  return saveAll(ctx, base, res);
}

/** Demo "Hurry": finish a timer instantly for free (§10.4). */
export async function hurry(ctx: Ctx, playerId: string, buildingId: string) {
  const { base, res } = await loadPlayer(ctx, playerId);
  const t = base.timers[buildingId];
  if (!t) throw new HttpError(404, 'nothing to hurry');
  t.readyAt = ctx.now();
  await settle(ctx, base, res);
  return saveAll(ctx, base, res);
}

export async function sealPrepare(ctx: Ctx, playerId: string) {
  const { base } = await loadPlayer(ctx, playerId);
  const errors = layoutErrors(base.layout);
  if (errors.length) throw new HttpError(409, errors[0]!);
  return { baseHash: baseHash(normalizeBase(base.layout)), version: base.version };
}

async function markSealed(ctx: Ctx, playerId: string, hash: Hex, tx: ReturnType<Ctx['chain']['ref']>) {
  const { player, base, res } = await loadPlayer(ctx, playerId);
  base.sealedHash = hash;
  base.sealedLayout = structuredClone(base.layout);
  base.sealedVersion = base.version;
  base.sealTx = tx;
  base.sealedAt = ctx.now();
  pushEvent(res, { icon: 'seal', title: 'Base sealed in the Ledger', body: `Seal ${hash.slice(0, 10)}…`, at: ctx.now(), tx }, ctx.now());
  const badge = await awardBadge(ctx, player, res, 'first_seal');
  await ctx.repo.bases.put(base);
  await ctx.repo.resources.put(res);
  return { sealed: true, baseHash: hash, sealTx: tx, base: baseDTO(base), badge };
}

/** The player's own sponsored `sealBase` tx landed; check the chain and record it. */
export async function sealConfirm(ctx: Ctx, playerId: string, txHash: Hex) {
  const { player, base } = await loadPlayer(ctx, playerId);
  const hash = baseHash(normalizeBase(base.layout));
  const r = await ctx.chain.confirmPlayerTx('seal', txHash, player.address);
  if (!r.ok) throw new HttpError(409, `seal not confirmed: ${r.reason}`);
  const onChain = await ctx.chain.sealOf(player.address);
  if (!onChain || onChain.baseHash.toLowerCase() !== hash.toLowerCase()) throw new HttpError(409, 'on-chain seal does not match this layout');
  return markSealed(ctx, playerId, hash, ctx.chain.ref('seal', txHash, r.block));
}

/** Fallback (and guest/mock path): the relayer submits `sealBaseFor` with an EIP-712 signature. */
export async function sealRelay(ctx: Ctx, playerId: string, sig: { signature?: string; deadline?: number }) {
  const { player, base } = await loadPlayer(ctx, playerId);
  const { baseHash: hash, version } = await sealPrepare(ctx, playerId);
  if (base.sealedHash === hash && base.sealTx) return { sealed: true, baseHash: hash, sealTx: base.sealTx, base: baseDTO(base), badge: null };
  const tx = await ctx.chain.sealBaseFor(signerOf(player, sig), hash, version);
  return markSealed(ctx, playerId, hash, tx);
}

/** Architect: tips with coverage numbers, plus a validated patch suggestion (§11 screen 04). */
export async function architectReview(ctx: Ctx, playerId: string, layoutOverride?: Layout): Promise<ArchitectReview> {
  const { base } = await loadPlayer(ctx, playerId);
  const layout = layoutOverride ?? base.layout;
  const before = analyzeLayout(layout);
  const patch = heuristicPatch(layout);
  const after = patch ? analyzeLayout(applyMoves(layout, patch.moves)) : null;
  const res = await ctx.agents.run<ArchitectOutput>({
    role: 'architect',
    task: 'tips',
    playerId,
    facts: { analysis: before, proposedPatch: patch, analysisAfterPatch: after },
    schema: RoleOutputs.architect,
    fallback: () => architectTips(before, patch?.rationale ?? null),
    tools: {
      get_layout: () => layout,
      analyze_layout: () => before,
      propose_layout_patch: (args) => {
        const a = args as { moves: { buildingId: string; x: number; y: number }[] };
        const err = validatePatch(layout, a.moves);
        return err ? { ok: false, error: err } : { ok: true, after: analyzeLayout(applyMoves(layout, a.moves)) };
      },
    },
  });
  return {
    tips: res.output.tips,
    patch: patch ? { moves: patch.moves, rationale: res.output.rationale ?? patch.rationale } : null,
    before,
    after,
    agent: { fallback: res.fallback, latencyMs: res.latencyMs },
  };
}

/** "Apply Architect fix": apply the pending (or freshly proposed) patch, validated, then re-seal. */
export async function applyPatch(ctx: Ctx, playerId: string) {
  const { player, base, res } = await loadPlayer(ctx, playerId);
  const patch = base.pendingPatch ?? heuristicPatch(base.layout);
  if (!patch) throw new HttpError(404, 'The Architect has nothing to change.');
  const err = validatePatch(base.layout, patch.moves);
  if (err) throw new HttpError(409, `Patch no longer fits: ${err}`);
  base.layout = applyMoves(base.layout, patch.moves);
  base.pendingPatch = null;
  const badge = await awardBadge(ctx, player, res, 'architects_pupil');
  return { moves: patch.moves, badge, ...(await saveAll(ctx, base, res)) };
}
