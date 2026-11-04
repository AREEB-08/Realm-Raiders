import { normalizeBase } from '@realm/battle-engine';
import { NPC_ISLANDS, PLAN_TEMPLATES, type Coaching, type Layout, type PlanId } from '@realm/game-data';
import { RoleOutputs, channels, ToolArgs, type PlanDTO, type StrategistOutput, type WarRoomDTO } from '@realm/shared';
import { planTip, strategistBrief } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { armyCapacity, troopLevel } from '../economy';
import { aggregate, armyCost, expandPlan, parseCoaching, practiceInputs, SIMS_PER_PLAN, templateById } from '../plans';
import { HttpError, type WarRoomDoc } from '../types';
import { loadPlayer, uid } from './common';
import { targetFor } from './targets';

function buildPlan(
  planId: PlanId,
  coaching: Coaching,
  note: string | null,
  layout: Layout,
  opts: { capacity: number; troopLevel: number; generalLevel: number },
  wallet: { timber: number; ember: number },
): PlanDTO {
  const tpl = templateById(planId)!;
  const base = normalizeBase(layout);
  const { army, actions, side } = expandPlan(tpl, coaching, base, opts);
  const cost = armyCost(army);
  return {
    planId,
    name: tpl.name,
    summary: tpl.summary,
    side,
    coaching,
    coachNote: note,
    army,
    actions,
    stats: null,
    cost,
    affordable: wallet.timber >= cost.timber && wallet.ember >= cost.ember,
    tip: '',
  };
}

async function simulatePlan(ctx: Ctx, warRoomId: string, plan: PlanDTO, layout: Layout) {
  const base = normalizeBase(layout);
  const inputs = practiceInputs(base, plan.army, plan.actions, plan.planId, SIMS_PER_PLAN);
  const ch = channels.warroom(warRoomId);
  const results = await ctx.sims.run(inputs, (done) =>
    ctx.bus.publish(ch, { t: 'sim', d: { planId: plan.planId, done, of: SIMS_PER_PLAN } }),
  );
  plan.stats = aggregate(results);
  plan.tip = planTip(plan);
  ctx.bus.publish(ch, { t: 'sim', d: { planId: plan.planId, done: SIMS_PER_PLAN, of: SIMS_PER_PLAN, stats: plan.stats } });
}

export function warRoomDTO(doc: WarRoomDoc, target: WarRoomDTO['target']): WarRoomDTO {
  return {
    warRoomId: doc.id,
    target,
    plans: doc.plans,
    recommended: doc.recommended,
    thoughts: doc.thoughts,
    agent: doc.agent,
  };
}

async function strategistComment(ctx: Ctx, playerId: string, doc: WarRoomDoc, targetName: string, layout: Layout) {
  const out = await ctx.agents.run<StrategistOutput>({
    role: 'strategist',
    task: 'warroom',
    playerId,
    facts: {
      target: targetName,
      plans: doc.plans.map((p) => ({ planId: p.planId, name: p.name, side: p.side, army: p.army.troops, stats: p.stats })),
    },
    schema: RoleOutputs.strategist,
    fallback: () => strategistBrief(doc.plans, targetName),
    tools: {
      get_target_base: () => ({ name: targetName, buildings: normalizeBase(layout).buildings.length }),
      list_plan_templates: () => PLAN_TEMPLATES.map((p) => ({ id: p.id, name: p.name, summary: p.summary })),
      run_simulations: (args) => {
        const a = ToolArgs.run_simulations.parse(args);
        return doc.plans.find((p) => p.planId === a.planId)?.stats ?? { error: 'unknown plan' };
      },
    },
    check: (o) => (o.recommended && !doc.plans.some((p) => p.planId === o.recommended) ? 'unknown plan' : null),
  });
  const fb = strategistBrief(doc.plans, targetName);
  doc.thoughts = out.output.thoughts.length ? out.output.thoughts : fb.thoughts;
  doc.recommended = out.output.recommended ?? fb.recommended!;
  for (const p of doc.plans) p.tip = out.output.tips?.[p.planId] ?? p.tip;
  doc.agent = { fallback: out.fallback, latencyMs: out.latencyMs };
  const hint = warRoomHint(doc.plans, doc.targetIslandId);
  if (hint) doc.thoughts = [...doc.thoughts, hint];
}

/**
 * Sefa's advice grounded in the 150 practice raids (spec F4): every plan wins 3★ → pick a
 * harder target; no plan wins at all → grow the army first.
 */
export function warRoomHint(plans: PlanDTO[], targetIslandId: string): string | null {
  const stats = plans.map((p) => p.stats).filter((s): s is NonNullable<PlanDTO['stats']> => !!s);
  if (stats.length !== plans.length || !stats.length) return null;
  if (stats.every((s) => s.winRate === 100 && s.avgStars === 3)) {
    const rank = { easy: 0, medium: 1, hard: 2 } as const;
    const here = NPC_ISLANDS.find((i) => i.key === targetIslandId);
    const harder = NPC_ISLANDS.filter((i) => !here || rank[i.difficulty] > rank[here.difficulty]).map((i) => i.name);
    return harder.length
      ? `All three plans take it with three stars every time. Too easy for us — try a harder target: ${harder.join(' or ')}.`
      : 'All three plans take it with three stars every time. Pick the cheapest and save the Ember.';
  }
  if (stats.every((s) => s.winRate === 0))
    return 'None of our plans breaks this holdfast yet. Upgrade the War Camp for a bigger army, or pick an easier target.';
  return null;
}

/** `POST /warroom` — expand the three plans and run 50 practice raids each (streamed over WS). */
export async function createWarRoom(ctx: Ctx, playerId: string, islandId: string, wait = false): Promise<WarRoomDTO> {
  const { base, res } = await loadPlayer(ctx, playerId);
  const { island, target } = await targetFor(ctx, playerId, islandId);
  const opts = { capacity: armyCapacity(base.layout), troopLevel: troopLevel(base.layout), generalLevel: 1 };
  const doc: WarRoomDoc = {
    id: uid('w_'),
    playerId,
    targetIslandId: islandId,
    plans: PLAN_TEMPLATES.map((t) => buildPlan(t.id, {}, null, island.layout, opts, res)),
    recommended: 'shieldwall',
    thoughts: ['Running the practice raids…'],
    agent: { fallback: true, latencyMs: 0 },
    status: 'simulating',
    createdAt: ctx.now(),
  };
  await ctx.repo.warRooms.put(doc);
  const work = (async () => {
    for (const plan of doc.plans) await simulatePlan(ctx, doc.id, plan, island.layout);
    await strategistComment(ctx, playerId, doc, island.name, island.layout);
    doc.status = 'ready';
    await ctx.repo.warRooms.put(doc);
    ctx.bus.publish(channels.warroom(doc.id), { t: 'warroom', d: warRoomDTO(doc, target) });
  })().catch((e) => ctx.log('war room failed', (e as Error).message));
  if (wait) await work;
  return warRoomDTO(doc, target);
}

export async function getWarRoom(ctx: Ctx, playerId: string, id: string) {
  const doc = await ctx.repo.warRooms.get(id);
  if (!doc || doc.playerId !== playerId) throw new HttpError(404, 'no such war room');
  const { target } = await targetFor(ctx, playerId, doc.targetIslandId);
  return { ...warRoomDTO(doc, target), status: doc.status };
}

/** `POST /warroom/:id/coach` — map the note to allowed adjustments, re-expand, re-simulate. */
export async function coachPlan(ctx: Ctx, playerId: string, id: string, planId: string, note: string) {
  const doc = await ctx.repo.warRooms.get(id);
  if (!doc || doc.playerId !== playerId) throw new HttpError(404, 'no such war room');
  const idx = doc.plans.findIndex((p) => p.planId === planId);
  if (idx < 0) throw new HttpError(404, 'no such plan');
  const { base, res } = await loadPlayer(ctx, playerId);
  const { island } = await targetFor(ctx, playerId, doc.targetIslandId);
  const current = doc.plans[idx]!;
  const mapped = await ctx.agents.run<Coaching>({
    role: 'strategist',
    task: 'coach',
    playerId,
    facts: { plan: { planId, side: current.side, army: current.army.troops, coaching: current.coaching } },
    playerText: note,
    schema: ToolArgs.apply_coaching.omit({ planId: true }) as never,
    fallback: () => parseCoaching(note, current),
    // A swap must give up a troop the plan actually has (else it is a misreading).
    check: (c) => (c.swap && !current.army.troops.some((e) => e.troop === c.swap!.from && e.count > 0) ? `the plan has no ${c.swap.from}` : null),
  });
  const opts = { capacity: armyCapacity(base.layout), troopLevel: troopLevel(base.layout), generalLevel: 1 };
  const coaching: Coaching = { ...current.coaching, ...mapped.output };
  const plan = buildPlan(current.planId, coaching, note, island.layout, opts, res);
  await simulatePlan(ctx, id, plan, island.layout);
  doc.plans[idx] = plan;
  await ctx.repo.warRooms.put(doc);
  return { plan, agent: { fallback: mapped.fallback, latencyMs: mapped.latencyMs } };
}
