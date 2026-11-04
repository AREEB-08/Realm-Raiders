import {
  ENGINE_VERSION,
  bytesToBase64,
  encodeReplay,
  fromHex,
  keccak,
  normalizeBase,
  replayHash,
  simulate,
  type BattleInput,
} from '@realm/battle-engine';
import { NPC_ISLANDS, PLAN_TEMPLATES, SHIELD_HOURS, SIDES, defenceRenown, lootFrom } from '@realm/game-data';
import {
  AUTOPILOT_KINDS,
  NightPolicy,
  RoleOutputs,
  canonicalHash,
  defaultPolicy,
  describePolicy,
  isActionAllowed,
  nightIdOf,
  nightOf,
  randomHex32,
  type AutopilotAction,
  type Hex,
  type NightActionDTO,
  type NightAttackDTO,
  type NightCaptainOutput,
  type NightPolicyDTO,
  type NightReportDTO,
  type PolicyDraft,
} from '@realm/shared';
import { nightDraft } from '../agents/fallback';
import type { Ctx } from '../ctx';
import { clampToCaps, troopLevel } from '../economy';
import { analyzeLayout, citadelLevelOf } from '../layout';
import { expandPlan } from '../plans';
import { HttpError, type BaseDoc, type BattleDoc, type PlayerDoc, type PolicyDoc, type ReportDoc, type ResourcesDoc } from '../types';
import { awardBadge, chainBattleId, loadPlayer, pushEvent, signerOf, uid } from './common';
import { architectReview } from './base';

const NIGHT_SECONDS = 8 * 3600;

function policyDTO(doc: PolicyDoc): NightPolicyDTO {
  return {
    policy: doc.policy,
    policyHash: doc.policyHash,
    nightId: doc.nightId,
    expiresAt: doc.expiresAt,
    commitTx: doc.commitTx,
    sealed: doc.sealed,
    summary: describePolicy(doc.policy),
  };
}

async function latestPolicy(ctx: Ctx, playerId: string) {
  const all = await ctx.repo.policies.find((p) => p.playerId === playerId);
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

async function activePolicy(ctx: Ctx, playerId: string) {
  const nowS = Math.floor(ctx.now() / 1000);
  const all = await ctx.repo.policies.find((p) => p.playerId === playerId && p.sealed && p.expiresAt > nowS);
  return all.sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export async function getPolicy(ctx: Ctx, playerId: string) {
  const doc = (await activePolicy(ctx, playerId)) ?? (await latestPolicy(ctx, playerId));
  return doc ? policyDTO(doc) : null;
}

/** The Night Captain drafts tonight's orders (allowed fields only). */
export async function draftPolicy(ctx: Ctx, playerId: string) {
  const { base } = await loadPlayer(ctx, playerId);
  const night = nightOf(new Date(ctx.now()));
  const analysis = analyzeLayout(base.layout);
  const cl = citadelLevelOf(base.layout);
  return ctx.agents.run<NightCaptainOutput>({
    role: 'night_captain',
    task: 'draft',
    playerId,
    facts: { night, citadel: cl, analysis, allowed: 'repairPriority walls|defenses|resources; reserveGoldPct 0-80; autoRetaliate; maxRetaliateCitadelDelta -2..2; shieldIfLossesOverPct 10-100' },
    schema: RoleOutputs.night_captain,
    fallback: () => nightDraft(night, analysis, cl),
    tools: {
      get_policy_options: () => ({ repairPriority: ['walls', 'defenses', 'resources'], reserveGoldPct: [0, 80], maxRetaliateCitadelDelta: [-2, 2], shieldIfLossesOverPct: [10, 100] }),
      draft_policy: (args) => ({ ok: true, policy: args }),
    },
  });
}

/** `POST /night/policy` — canonicalise and hash the orders; nothing is sealed yet. */
export async function preparePolicy(ctx: Ctx, playerId: string, partial: Partial<PolicyDraft> = {}) {
  await loadPlayer(ctx, playerId);
  const active = await activePolicy(ctx, playerId);
  if (active) throw new HttpError(409, "Tonight's orders are sealed until morning.");
  const night = nightOf(new Date(ctx.now()));
  const policy = NightPolicy.parse({ ...defaultPolicy(night), ...partial, v: 1, night });
  const doc: PolicyDoc = {
    id: uid('n_'),
    playerId,
    nightId: nightIdOf(night),
    policy,
    policyHash: canonicalHash(policy),
    commitTx: null,
    expiresAt: Math.floor(ctx.now() / 1000) + NIGHT_SECONDS,
    sealed: false,
    createdAt: ctx.now(),
  };
  await ctx.repo.policies.put(doc);
  return policyDTO(doc);
}

/** Seal the orders: confirm the player's own `commitPolicy` tx, or relay `commitPolicyFor`. */
export async function confirmPolicy(ctx: Ctx, playerId: string, body: { txHash?: string; signature?: string; deadline?: number }) {
  const { player } = await loadPlayer(ctx, playerId);
  const doc = await latestPolicy(ctx, playerId);
  if (!doc) throw new HttpError(404, 'draft orders first');
  if (doc.sealed) return policyDTO(doc);
  if (body.txHash) {
    const r = await ctx.chain.confirmPlayerTx('policy', body.txHash as Hex, player.address);
    if (!r.ok) throw new HttpError(409, `policy not confirmed: ${r.reason}`);
    doc.commitTx = ctx.chain.ref('policy', body.txHash as Hex, r.block);
  } else {
    doc.commitTx = await ctx.chain.commitPolicyFor(signerOf(player, body), doc.nightId, doc.policyHash, doc.expiresAt);
  }
  const onChain = await ctx.chain.policyOf(player.address, doc.nightId);
  if (!onChain || onChain.policyHash.toLowerCase() !== doc.policyHash.toLowerCase())
    throw new HttpError(409, 'on-chain policy hash does not match');
  doc.sealed = true;
  await ctx.repo.policies.put(doc);
  return policyDTO(doc);
}

function actionText(a: AutopilotAction): string {
  switch (a.kind) {
    case 'repair':
      return `Repaired ${a.detail.category === 'defenses' ? 'defences' : a.detail.category} first.`;
    case 'reserve':
      return `Kept ${a.detail.protectedGold} gold out of the raiders' reach.`;
    case 'retaliate':
      return `Struck back at the raiders' camp (Citadel delta ${a.detail.targetCitadelDelta}).`;
    case 'shield':
      return `Raised the storm-shield after losing ${a.detail.lossPct}%.`;
  }
}

/**
 * The Night Captain acts — but only inside the sealed orders. Each action is checked against the
 * policy here, then logged on-chain with the policy hash (the contract re-checks the hash).
 */
export async function executeAutopilot(
  ctx: Ctx,
  player: { address: Hex },
  policy: PolicyDoc,
  action: AutopilotAction,
): Promise<NightActionDTO> {
  const gate = isActionAllowed(policy.policy, action);
  const text = actionText(action);
  if (!gate.ok) return { kind: action.kind, text, allowed: false, reason: gate.reason, actionHash: null, tx: null };
  const actionHash = canonicalHash({ kind: action.kind, detail: action.detail, nightId: policy.nightId });
  let tx = null;
  try {
    tx = await ctx.chain.logAutopilot(player.address, policy.nightId, policy.policyHash, AUTOPILOT_KINDS[action.kind], actionHash);
  } catch (e) {
    return { kind: action.kind, text, allowed: false, reason: (e as Error).message, actionHash, tx: null };
  }
  return { kind: action.kind, text, allowed: true, actionHash, tx };
}

export interface HoldfastRaid {
  attack: NightAttackDTO;
  battleId: string;
  npcCitadel: number;
  destructionBp: number;
  destructionPct: number;
  /** Gold the raid would have taken, and what it did take once the reserve was protected. */
  goldLoss: number;
  takenGold: number;
}

/**
 * One rival raiding party against the player's sealed base (night raids and Auto Mode defence),
 * proven like any raid: commit, reveal, a deterministic replay and `recordDefence` on chain.
 * Mutates `res` (losses, Renown, defence stats) and stores the battle; the caller saves `res`.
 */
export async function raidHoldfast(
  ctx: Ctx,
  o: { playerId: string; player: PlayerDoc; base: BaseDoc; res: ResourcesDoc; npc: PlayerDoc; planIndex: number; reserveGoldPct: number },
): Promise<HoldfastRaid> {
  const { playerId, player, base, res, npc } = o;
  if (!base.sealedHash || !base.sealedLayout) throw new HttpError(409, 'Seal your base in the Ledger first.');
  const defenderBase = normalizeBase(base.sealedLayout);
  const island = await ctx.repo.islands.get(npc.npcKey!);
  const npcCitadel = island ? citadelLevelOf(island.layout) : 1;
  const name = island?.ownerName ?? 'Raiders';
  const id = uid('b_');
  const onChainId = chainBattleId(id);
  const secret = randomHex32();
  const nonce = randomHex32();
  await ctx.chain.commitBattle({
    battleId: onChainId,
    attacker: npc.address,
    defender: player.address,
    defenderBaseHash: base.sealedHash,
    secretHash: keccak(fromHex(secret)),
    attackerNonce: nonce,
  });
  const { tx: revealTx, seed } = await ctx.chain.revealSeed(onChainId, secret);
  const tpl = PLAN_TEMPLATES[o.planIndex % PLAN_TEMPLATES.length]!;
  const side = SIDES[fromHex(seed)[0]! % 4]!;
  // Raiding parties, not the lord's host: no General, and sized by the attacker's Citadel
  // (4 + 2×CL housing), so a sealed starter base can hold the weakest.
  const full = expandPlan(tpl, { side }, defenderBase, {
    capacity: 4 + 2 * npcCitadel,
    troopLevel: island ? troopLevel(island.layout) : 1,
    generalLevel: 1,
  });
  const plan = {
    army: { troops: full.army.troops.filter((e) => e.troop !== 'general') },
    actions: full.actions.filter((a) => a.kind !== 'rally' && !(a.kind === 'deploy' && a.troop === 'general')),
  };
  const input: BattleInput = { engineVersion: ENGINE_VERSION, seed, base: defenderBase, army: plan.army, actions: plan.actions };
  const r = simulate({ ...input, defenderStored: { gold: res.gold, timber: res.timber } });
  const bytes = encodeReplay(input);
  const rh = replayHash(bytes);
  const delta = defenceRenown(r.stars);
  let resultTx = null;
  try {
    resultTx = await ctx.chain.recordDefence(onChainId, rh, r.stars, r.destructionBp, delta);
  } catch (e) {
    ctx.log('recordDefence failed', (e as Error).message);
  }
  // Losses, with the reserve protecting part of the treasury.
  const loss = lootFrom({ gold: res.gold, timber: res.timber });
  const goldLoss = Math.floor((loss.gold * r.destructionBp) / 10000);
  const timberLoss = Math.floor((loss.timber * r.destructionBp) / 10000);
  const protectedGold = Math.floor((res.gold * o.reserveGoldPct) / 100);
  const takenGold = Math.min(goldLoss, Math.max(0, res.gold - protectedGold));
  res.gold -= takenGold;
  res.timber -= timberLoss;
  res.renown += delta;
  if (r.stars <= 1) {
    res.stats.defWon++;
    res.stats.nightWatchWins++;
  } else res.stats.defLost++;
  const battle: BattleDoc = {
    id,
    kind: 'night',
    chainBattleId: onChainId,
    attackerId: npc.id,
    attackerAddress: npc.address,
    attackerName: name,
    defenderId: playerId,
    defenderAddress: player.address,
    defenderName: (await ctx.repo.generals.get(playerId))?.name ?? 'Your holdfast',
    islandId: island?.id ?? null,
    planId: tpl.id,
    seed,
    secret,
    attackerNonce: nonce,
    commitTx: revealTx,
    revealTx,
    baseHash: base.sealedHash,
    base: defenderBase,
    army: plan.army,
    engineVersion: ENGINE_VERSION,
    attackerCitadel: npcCitadel,
    defenderStored: { gold: res.gold, timber: res.timber },
    replay: bytesToBase64(bytes),
    replayHash: rh,
    stars: r.stars,
    destructionBp: r.destructionBp,
    renown: delta,
    loot: { gold: takenGold, timber: timberLoss },
    resultTx,
    feedbackTx: null,
    status: resultTx ? 'recorded' : 'verified',
    report: null,
    createdAt: ctx.now(),
  };
  await ctx.repo.battles.put(battle);
  return {
    attack: { battleId: id, attacker: name, attackerCitadel: npcCitadel, stars: r.stars, destructionPct: r.destructionPct, renownDelta: delta, blocked: false, resultTx },
    battleId: id,
    npcCitadel,
    destructionBp: r.destructionBp,
    destructionPct: r.destructionPct,
    goldLoss,
    takenGold,
  };
}

/** The rival lords, in the fixed order raiding parties come from. */
export async function rivalLords(ctx: Ctx) {
  return (await ctx.repo.players.find((p) => !!p.npcKey)).sort(
    (a, b) => NPC_ISLANDS.findIndex((n) => n.key === a.npcKey) - NPC_ISLANDS.findIndex((n) => n.key === b.npcKey),
  );
}

/** `POST /night/simulate` — three NPC raids against the sealed base under tonight's orders. */
export async function simulateNight(ctx: Ctx, playerId: string) {
  const { player, base, res } = await loadPlayer(ctx, playerId);
  const policy = await activePolicy(ctx, playerId);
  if (!policy) throw new HttpError(409, "Seal tonight's orders first.");
  const onChainSeal = await ctx.chain.sealOf(player.address);
  if (!base.sealedHash || !base.sealedLayout || !onChainSeal || onChainSeal.baseHash.toLowerCase() !== base.sealedHash.toLowerCase())
    throw new HttpError(409, 'Seal your base in the Ledger first — raiders need a sealed base to be judged against.');
  const myCitadel = citadelLevelOf(base.sealedLayout);
  const attacks: NightAttackDTO[] = [];
  const actions: NightActionDTO[] = [];
  let renownDelta = 0;
  let shielded = false;
  const npcs = await rivalLords(ctx);
  for (let i = 0; i < Math.min(3, npcs.length); i++) {
    const npc = npcs[i]!;
    if (shielded) {
      const island = await ctx.repo.islands.get(npc.npcKey!);
      const name = island?.ownerName ?? 'Raiders';
      attacks.push({ battleId: '', attacker: name, attackerCitadel: island ? citadelLevelOf(island.layout) : 1, stars: 0, destructionPct: 0, renownDelta: 0, blocked: true, resultTx: null });
      continue;
    }
    const raid = await raidHoldfast(ctx, { playerId, player, base, res, npc, planIndex: i, reserveGoldPct: policy.policy.reserveGoldPct });
    const { attack, battleId: id, npcCitadel, goldLoss, takenGold } = raid;
    const r = { destructionBp: raid.destructionBp, destructionPct: raid.destructionPct };
    renownDelta += attack.renownDelta;
    attacks.push(attack);
    // Autopilot, strictly inside the orders.
    if (r.destructionBp > 0)
      actions.push(await executeAutopilot(ctx, player, policy, { kind: 'repair', detail: { category: policy.policy.repairPriority, attackId: id } }));
    if (goldLoss > takenGold)
      actions.push(await executeAutopilot(ctx, player, policy, { kind: 'reserve', detail: { protectedGold: goldLoss - takenGold, attackId: id } }));
    if (policy.policy.autoRetaliate) {
      const a = await executeAutopilot(ctx, player, policy, { kind: 'retaliate', detail: { targetCitadelDelta: npcCitadel - myCitadel, attackId: id } });
      if (a.allowed) {
        res.renown += 3;
        renownDelta += 3;
      }
      actions.push(a);
    }
    if (r.destructionPct >= policy.policy.shieldIfLossesOverPct) {
      const a = await executeAutopilot(ctx, player, policy, { kind: 'shield', detail: { lossPct: Math.round(r.destructionPct), attackId: id } });
      if (a.allowed) {
        shielded = true;
        res.shieldUntil = Math.max(res.shieldUntil ?? 0, ctx.now() + SHIELD_HOURS * 3_600_000);
      }
      actions.push(a);
    }
  }
  clampToCaps(res, base.layout);
  const held = attacks.filter((a) => !a.blocked && a.stars <= 1).length;
  const fought = attacks.filter((a) => !a.blocked).length;
  const intel = {
    headline: `${fought} raid${fought === 1 ? '' : 's'} in the night: ${held} held, ${fought - held} breached. Renown ${renownDelta >= 0 ? '+' : ''}${renownDelta}.`,
    keyMoments: attacks.map((a, i) => ({
      tick: i,
      text: a.blocked
        ? `${a.attacker} turned back at the storm-shield.`
        : `${a.attacker}: ${'★'.repeat(a.stars)}${'☆'.repeat(3 - a.stars)} at ${Math.round(a.destructionPct)}%.`,
    })),
    opponentNotes: [`Every action above carries the orders' seal ${policy.policyHash.slice(0, 10)}…`],
  };
  const architect = await architectReview(ctx, playerId, base.layout);
  const report: ReportDoc = {
    id: uid('r_'),
    playerId,
    policyId: policy.id,
    nightId: policy.nightId,
    policyHash: policy.policyHash,
    policyTx: policy.commitTx,
    attacks,
    actions,
    renownDelta,
    intel,
    architect,
    seen: false,
    createdAt: ctx.now(),
  };
  const fresh = await loadPlayer(ctx, playerId);
  fresh.base.pendingPatch = architect.patch ? { ...architect.patch, reportId: report.id } : null;
  await ctx.repo.bases.put(fresh.base);
  if (res.stats.nightWatchWins >= 3) await awardBadge(ctx, player, res, 'night_watch');
  pushEvent(res, { icon: 'night', title: 'Morning Report ready', body: intel.headline, at: ctx.now() }, ctx.now());
  await ctx.repo.resources.put(res);
  await ctx.repo.reports.put(report);
  return { reportId: report.id };
}

export function reportDTO(r: ReportDoc): NightReportDTO {
  return {
    reportId: r.id,
    nightId: r.nightId,
    policyHash: r.policyHash,
    policyTx: r.policyTx,
    attacks: r.attacks,
    actions: r.actions,
    renownDelta: r.renownDelta,
    intel: r.intel,
    architect: r.architect,
    createdAt: r.createdAt,
  };
}

export async function getReport(ctx: Ctx, playerId: string, reportId?: string) {
  const all = await ctx.repo.reports.find((r) => r.playerId === playerId);
  const r = reportId ? all.find((x) => x.id === reportId) : all.sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!r) return null;
  if (!r.seen) {
    r.seen = true;
    await ctx.repo.reports.put(r);
  }
  return reportDTO(r);
}
