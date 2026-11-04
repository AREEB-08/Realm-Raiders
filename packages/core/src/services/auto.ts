import { baseHash, bytesToBase64, createBattle, encodeReplay, normalizeBase, step, type BattleInput } from '@realm/battle-engine';
import {
  AUTO_BEAT_MINUTES,
  AUTO_BLOCK_MINUTES,
  AUTO_GEMS_PER_BLOCK,
  BUILDERS,
  BUILDINGS,
  SHIELD_HOURS,
  buildCost,
  limitFor,
  maxLevelFor,
  type BuildingCategory,
  type BuildingId,
} from '@realm/game-data';
import {
  AUTO_BLOCKED,
  AUTO_KINDS,
  AutoOrders,
  AutoOrdersDraft,
  DEFAULT_AUTO_ORDERS,
  autoOrdersHash,
  autoSessionId,
  canonicalHash,
  describeAutoOrders,
  isAutoActionAllowed,
  type AutoAction,
  type AutoLogEntry,
  type AutoOfficer,
  type AutoSessionDTO,
  type HomeDTO,
  type Hex,
  type TxRef,
} from '@realm/shared';
import type { AgentRunner, Ctx } from '../ctx';
import { armyCapacity, capacities, clampToCaps, collect, producers, troopLevel } from '../economy';
import { analyzeLayout, canPlace, citadelLevelOf, heuristicPatch, occupancy, validatePatch } from '../layout';
import { HttpError, type AutoSessionDoc, type PlayerDoc } from '../types';
import { applyPatch, build, sealRelay, upgrade } from './base';
import { commitBattle, submitBattle } from './battle';
import { loadPlayer, pushEvent, signerOf, uid } from './common';
import { gemsOf, grantGems } from './gems';
import { settle } from './home';
import { raidHoldfast, rivalLords } from './night';
import { listTargets } from './targets';
import { createWarRoom } from './warroom';

/**
 * Auto Mode (spec F8) — "the agents handle everything".
 *
 * A session is a deterministic step machine: beat k runs at startedAt + k x 5 min, in order, with
 * the clock pinned to that moment and the officers on their rule-based field manual (never the
 * LLM). The server runs due beats from a scheduler even when the app is closed; the offline realm
 * runs them while the app is open and, on resume, catches up on the beats it missed (never past the
 * paid time). Every action goes through `isAutoActionAllowed` against the sealed orders and is
 * logged with `logAutopilot` *before* it is carried out, exactly like the Night Captain.
 */
const BEAT = AUTO_BEAT_MINUTES * 60_000;
const BLOCK = AUTO_BLOCK_MINUTES * 60_000;
/** Collect at most this often (one Ledger entry per collection round). */
const COLLECT_EVERY = 15 * 60_000;
/** Re-seal a changed base at most this often while upgrades keep landing. */
const RESEAL_EVERY = 30 * 60_000;
/** A rival raiding party tests the walls 25 minutes in, then every 2 hours. */
const RAID_IN_AT = 25;
const RAID_IN_EVERY = 120;
/** The orders' seal outlives the session, so a resumed phone can still file catch-up actions (no beat ever runs past `endsAt`). */
const SEAL_GRACE_S = 12 * 3600;
const LOG_CAP = 300;

const fieldManual: AgentRunner = { run: async (req) => ({ output: req.fallback(), fallback: true, latencyMs: 0 }) };
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');
const totalBeats = (s: Pick<AutoSessionDoc, 'orders'>) => s.orders.minutes / AUTO_BEAT_MINUTES;

export function durationLabel(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hs = h ? `${h} hour${h === 1 ? '' : 's'}` : '';
  return [hs, m ? `${m} min` : ''].filter(Boolean).join(' ');
}

// ---------------------------------------------------------------------------- reading ---

async function sessions(ctx: Ctx, playerId: string) {
  return (await ctx.repo.autoSessions.find((s) => s.playerId === playerId)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function runningSession(ctx: Ctx, playerId: string) {
  return (await sessions(ctx, playerId)).find((s) => s.status === 'running') ?? null;
}

/** Manual play is paused while the officers are in charge (the routes call this first). */
export async function assertManual(ctx: Ctx, playerId: string) {
  if (playerId && (await runningSession(ctx, playerId))) throw new HttpError(423, AUTO_BLOCKED);
}

function behind(s: AutoSessionDoc, now: number) {
  if (s.status !== 'running') return 0;
  const due = Math.min(totalBeats(s), Math.floor((Math.min(now, s.endsAt - 1) - s.startedAt) / BEAT) + 1);
  return Math.max(0, due - s.beat);
}

export function autoDTO(s: AutoSessionDoc, now: number): AutoSessionDTO {
  return {
    id: s.id,
    status: s.status === 'draft' ? 'stopped' : s.status,
    orders: s.orders,
    ordersHash: s.ordersHash,
    summary: describeAutoOrders(s.orders),
    commitTx: s.commitTx,
    startedAt: s.startedAt,
    endsAt: s.endsAt,
    endedAt: s.endedAt,
    gemsSpent: s.blocksPaid * AUTO_GEMS_PER_BLOCK,
    moves: s.moves,
    behind: behind(s, now),
    log: s.log,
  };
}

/** For the Home HUD: the running session, or the last one until its end has been seen. */
export async function autoBadge(ctx: Ctx, playerId: string): Promise<HomeDTO['auto']> {
  const s = (await sessions(ctx, playerId)).find((x) => x.status !== 'draft');
  if (!s || (s.status !== 'running' && s.seen)) return null;
  return { id: s.id, status: s.status as AutoSessionDTO['status'], endsAt: s.endsAt, moves: s.moves, behind: behind(s, ctx.now()) };
}

/** `GET /auto` — the latest session and its Auto Log (an ended session counts as seen). */
export async function getAuto(ctx: Ctx, playerId: string) {
  const s = (await sessions(ctx, playerId)).find((x) => x.status !== 'draft');
  if (!s) return { session: null };
  if (s.status !== 'running' && !s.seen) {
    s.seen = true;
    await ctx.repo.autoSessions.put(s);
  }
  return { session: autoDTO(s, ctx.now()) };
}

// ----------------------------------------------------------------------- the orders ---

/** Watch-Captain Hale drafts the Auto Orders from the base he sees (the player can edit them). */
export async function draftAutoOrders(ctx: Ctx, playerId: string) {
  const { base, res } = await loadPlayer(ctx, playerId);
  const a = analyzeLayout(base.layout);
  return ctx.agents.run<AutoOrdersDraft>({
    role: 'night_captain',
    task: 'auto',
    playerId,
    facts: { analysis: a, gold: res.gold, allowed: 'raidsPerHour 0-4; minWinPct 50-100; reserveGoldPct 0-80; upgradeFirst defences|resources|army; strikeBack; shieldAtPct 10-100' },
    schema: AutoOrdersDraft,
    fallback: () => ({
      ...DEFAULT_AUTO_ORDERS,
      // Thin defences → towers first; a well-covered Citadel → grow the economy.
      upgradeFirst: a.defenceCount < 4 || a.coveredCitadelPct < 60 ? 'defences' : a.exposedStorages.length ? 'defences' : 'resources',
    }),
  });
}

/** `POST /auto/prepare` — fix the orders and their hash under a fresh on-chain id (nothing sealed yet). */
export async function prepareAuto(ctx: Ctx, playerId: string, minutes: AutoOrders['minutes'], draft: AutoOrdersDraft) {
  const { player, res } = await loadPlayer(ctx, playerId);
  if (await runningSession(ctx, playerId)) throw new HttpError(409, 'Auto Mode is already running.');
  if (gemsOf(res) < AUTO_GEMS_PER_BLOCK) throw new HttpError(402, `Not enough Gems: Auto Mode costs ${AUTO_GEMS_PER_BLOCK} Gems per ${AUTO_BLOCK_MINUTES} minutes.`);
  const now = ctx.now();
  const used = new Set((await sessions(ctx, playerId)).map((s) => s.chainId));
  let chainId = autoSessionId(now);
  for (let bump = 1; used.has(chainId) || ((await ctx.chain.policyOf(player.address, chainId))?.expiresAt ?? 0) > now / 1000; bump++)
    chainId = autoSessionId(now, bump);
  const orders = AutoOrders.parse({ ...DEFAULT_AUTO_ORDERS, ...draft, v: 1, kind: 'auto', session: chainId, minutes });
  const doc: AutoSessionDoc = {
    id: uid('a_'),
    playerId,
    chainId,
    orders,
    ordersHash: autoOrdersHash(orders),
    commitTx: null,
    sealed: false,
    status: 'draft',
    startedAt: 0,
    endsAt: 0,
    endedAt: null,
    beat: 0,
    blocksPaid: 0,
    moves: 0,
    rooms: {},
    raidTimes: [],
    lastCollectAt: null,
    lastSealAt: null,
    changes: 0,
    patched: false,
    log: [],
    seen: false,
    createdAt: now,
  };
  await ctx.repo.autoSessions.put(doc);
  // Same shape as the night orders, so the phone seals both the same way.
  return { sessionId: doc.id, nightId: chainId, policyHash: doc.ordersHash, expiresAt: Math.floor(now / 1000) + minutes * 60 + SEAL_GRACE_S, summary: describeAutoOrders(orders) };
}

/** `POST /auto/confirm` — seal the orders on chain, pay the first block and hand over to the officers. */
export async function confirmAuto(ctx: Ctx, playerId: string, body: { txHash?: string; signature?: string; deadline?: number }) {
  const { player, res } = await loadPlayer(ctx, playerId);
  if (await runningSession(ctx, playerId)) throw new HttpError(409, 'Auto Mode is already running.');
  const doc = (await sessions(ctx, playerId)).find((s) => s.status === 'draft');
  if (!doc) throw new HttpError(404, 'Confirm the Auto Orders first.');
  if (gemsOf(res) < AUTO_GEMS_PER_BLOCK) throw new HttpError(402, `Not enough Gems: Auto Mode costs ${AUTO_GEMS_PER_BLOCK} Gems per ${AUTO_BLOCK_MINUTES} minutes.`);
  const expiresAt = Math.floor(doc.createdAt / 1000) + doc.orders.minutes * 60 + SEAL_GRACE_S;
  if (body.txHash) {
    const r = await ctx.chain.confirmPlayerTx('policy', body.txHash as Hex, player.address);
    if (!r.ok) throw new HttpError(409, `orders not confirmed: ${r.reason}`);
    doc.commitTx = ctx.chain.ref('policy', body.txHash as Hex, r.block);
  } else {
    doc.commitTx = await ctx.chain.commitPolicyFor(signerOf(player, body), doc.chainId, doc.ordersHash, expiresAt);
  }
  const onChain = await ctx.chain.policyOf(player.address, doc.chainId);
  if (!onChain || onChain.policyHash.toLowerCase() !== doc.ordersHash.toLowerCase()) throw new HttpError(409, 'on-chain orders hash does not match');
  const now = ctx.now();
  doc.sealed = true;
  doc.status = 'running';
  doc.startedAt = now;
  doc.endsAt = now + doc.orders.minutes * 60_000;
  doc.blocksPaid = 1;
  await grantGems(ctx, res, -AUTO_GEMS_PER_BLOCK, 'auto', `Auto Mode ${durationLabel(AUTO_BLOCK_MINUTES)}`, `g_auto_${doc.id}`);
  pushEvent(res, { icon: 'night', title: 'Auto Mode on', body: `Your officers run the realm for ${durationLabel(doc.orders.minutes)}.`, at: now, tx: doc.commitTx }, now);
  await ctx.repo.resources.put(res);
  doc.log.push(note(now, 'night_captain', 'Orders locked on Monad ✓', doc.commitTx));
  await ctx.repo.autoSessions.put(doc);
  kickAuto(ctx, playerId);
  return autoDTO(doc, now);
}

/** `POST /auto/stop` — TAKE CONTROL: stops at once. The running block is not refunded. */
export async function stopAuto(ctx: Ctx, playerId: string) {
  const s = await runningSession(ctx, playerId);
  if (!s) {
    const last = (await sessions(ctx, playerId)).find((x) => x.status !== 'draft');
    return last ? autoDTO(last, ctx.now()) : null;
  }
  const now = ctx.now();
  s.status = 'stopped';
  s.endedAt = now;
  s.seen = true;
  s.log.push(note(now, 'general', `You took control. Your officers made ${s.moves} move${s.moves === 1 ? '' : 's'}.`));
  await ctx.repo.autoSessions.put(s);
  return autoDTO(s, now);
}

// ------------------------------------------------------------------------ the beats ---

function note(at: number, officer: AutoOfficer, text: string, tx: TxRef | null = null): AutoLogEntry {
  return { at, officer, kind: 'note', text, allowed: true, actionHash: null, tx };
}

const locks = new WeakMap<Ctx, Map<string, Promise<void>>>();

/** Run the beats that are due, one player at a time (safe to call often). */
export function advanceAuto(ctx: Ctx, playerId: string): Promise<void> {
  let m = locks.get(ctx);
  if (!m) locks.set(ctx, (m = new Map()));
  const prev = m.get(playerId) ?? Promise.resolve();
  const next = prev.then(() => runDue(ctx, playerId)).catch((e) => ctx.log('auto mode beat failed', (e as Error).message));
  m.set(playerId, next);
  return next;
}

export function kickAuto(ctx: Ctx, playerId: string) {
  void advanceAuto(ctx, playerId);
}

/** Save the session without undoing a TAKE CONTROL that landed while a beat was running. */
async function save(ctx: Ctx, s: AutoSessionDoc) {
  const cur = await ctx.repo.autoSessions.get(s.id);
  if (cur && cur.status !== 'running' && s.status === 'running') {
    s.status = cur.status;
    s.endedAt = cur.endedAt;
    s.seen = cur.seen;
    const key = (e: AutoLogEntry) => `${e.at}|${e.text}`;
    const mine = new Set(s.log.map(key));
    s.log.push(...cur.log.filter((e) => !mine.has(key(e))));
  }
  if (s.log.length > LOG_CAP) s.log = s.log.slice(-LOG_CAP);
  await ctx.repo.autoSessions.put(s);
}

async function runDue(ctx: Ctx, playerId: string) {
  for (;;) {
    const s = await runningSession(ctx, playerId);
    if (!s) return;
    const now = ctx.now();
    if (s.beat >= totalBeats(s)) {
      if (now >= s.endsAt) await finish(ctx, s, 'finished', s.endsAt);
      return;
    }
    const t = s.startedAt + s.beat * BEAT;
    if (t > now) return;
    const at: Ctx = { ...ctx, now: () => t, agents: fieldManual };
    // Pay for the 30-minute block this beat opens.
    if (Math.floor((t - s.startedAt) / BLOCK) >= s.blocksPaid) {
      const { res } = await loadPlayer(at, playerId);
      if (gemsOf(res) < AUTO_GEMS_PER_BLOCK) {
        await finish(at, s, 'out_of_gems', t);
        return;
      }
      s.blocksPaid++;
      await grantGems(at, res, -AUTO_GEMS_PER_BLOCK, 'auto', `Auto Mode ${durationLabel(s.blocksPaid * AUTO_BLOCK_MINUTES)}`, `g_auto_${s.id}`);
      await ctx.repo.resources.put(res);
    }
    await runBeat(at, s);
    s.beat++;
    await save(ctx, s);
  }
}

async function finish(ctx: Ctx, s: AutoSessionDoc, status: 'finished' | 'out_of_gems', t: number) {
  s.status = status;
  s.endedAt = t;
  s.seen = false;
  const moves = `${s.moves} move${s.moves === 1 ? '' : 's'}`;
  const { res } = await loadPlayer(ctx, s.playerId);
  if (status === 'finished') {
    s.log.push(note(t, 'intel', `Auto Mode finished. Your officers made ${moves}.`));
    pushEvent(res, { icon: 'night', title: 'Auto Mode finished', body: `Your officers made ${moves}. Read the Auto Log.`, at: t }, t);
  } else {
    s.log.push(note(t, 'intel', 'Out of Gems — Auto Mode stopped.'));
    pushEvent(res, { icon: 'night', title: 'Out of Gems — Auto Mode stopped', body: 'Earn more by raiding and winning duels.', at: t }, t);
  }
  await ctx.repo.resources.put(res);
  await save(ctx, s);
}

/**
 * Carry out one action: check it against the sealed orders, log it on chain, then do it. A refused
 * action is written to the Auto Log (✗) and nothing happens; the same refusal isn't repeated.
 */
async function act(
  ctx: Ctx,
  s: AutoSessionDoc,
  player: PlayerDoc,
  officer: AutoOfficer,
  action: AutoAction,
  text: string,
  perform: () => Promise<{ text?: string; battleId?: string } | void>,
  quiet = false,
): Promise<boolean> {
  const at = ctx.now();
  const gate = isAutoActionAllowed(s.orders, action);
  if (!gate.ok) {
    const entry: AutoLogEntry = { at, officer, kind: action.kind, text: `Refused: ${text}`, allowed: false, reason: gate.reason, actionHash: null, tx: null };
    if (!quiet && !s.log.slice(-12).some((e) => !e.allowed && e.text === entry.text)) s.log.push(entry);
    return false;
  }
  const actionHash = canonicalHash({ kind: action.kind, detail: action.detail, session: s.chainId, beat: s.beat });
  let tx: TxRef | null = null;
  try {
    tx = await ctx.chain.logAutopilot(player.address, s.chainId, s.ordersHash, AUTO_KINDS[action.kind], actionHash);
  } catch (e) {
    s.log.push({ at, officer, kind: action.kind, text: `Refused: ${text}`, allowed: false, reason: `the Ledger refused it (${(e as Error).message})`, actionHash, tx: null });
    return false;
  }
  try {
    const out = await perform();
    s.log.push({ at, officer, kind: action.kind, text: out?.text ?? text, allowed: true, actionHash, tx, battleId: out?.battleId });
    s.moves++;
    return true;
  } catch (e) {
    s.log.push({ at, officer, kind: action.kind, text: `${text} — failed`, allowed: false, reason: (e as Error).message, actionHash, tx });
    return false;
  }
}

async function runBeat(ctx: Ctx, s: AutoSessionDoc) {
  const t = ctx.now();
  const pid = s.playerId;
  // Finished upgrades count as changes for the next seal.
  {
    const { base, res } = await loadPlayer(ctx, pid);
    const done = await settle(ctx, base, res);
    for (const id of done) {
      const b = base.layout.buildings.find((x) => x.id === id);
      if (b) s.log.push(note(t, 'architect', b.level === 1 ? `${BUILDINGS[b.type].name} is built.` : `${BUILDINGS[b.type].name} reached level ${b.level}.`));
    }
    s.changes += done.length;
  }
  await stewardCollects(ctx, s);
  await masonBuilds(ctx, s);
  await masonSeals(ctx, s);
  await strategistRaids(ctx, s);
  await captainDefends(ctx, s);
}

/** The General (as steward) collects from every producer, about every 15 minutes. */
async function stewardCollects(ctx: Ctx, s: AutoSessionDoc) {
  const t = ctx.now();
  if (s.lastCollectAt !== null && t - s.lastCollectAt < COLLECT_EVERY) return;
  const { player, base, res } = await loadPlayer(ctx, s.playerId);
  const ready = producers(base, t).filter((p) => p.pending > 0);
  if (!ready.length) return;
  const cap = capacities(base.layout);
  if (ready.every((p) => res[p.resource] >= cap[p.resource])) {
    if (!s.log.slice(-12).some((e) => e.text.startsWith('Storage is full'))) s.log.push(note(t, 'general', 'Storage is full — an upgraded Treasury or Timber Yard would hold more.'));
    s.lastCollectAt = t;
    return;
  }
  s.lastCollectAt = t;
  await act(ctx, s, player, 'general', { kind: 'collect', detail: { buildings: ready.map((p) => p.buildingId) } }, `Collected from ${ready.length} buildings`, async () => {
    const got = { gold: 0, timber: 0, ember: 0 };
    for (const p of ready) got[p.resource] += collect(base, res, p.buildingId, t);
    await ctx.repo.bases.put(base);
    await ctx.repo.resources.put(res);
    const parts = (['gold', 'timber', 'ember'] as const).filter((r) => got[r] > 0).map((r) => `${fmt(got[r])} ${r[0]!.toUpperCase()}${r.slice(1)}`);
    const from = ready.length === 1 ? `the ${BUILDINGS[base.layout.buildings.find((b) => b.id === ready[0]!.buildingId)!.type].name}` : `${ready.length} buildings`;
    return { text: `Collected ${parts.join(' and ') || 'nothing'} from ${from}` };
  });
}

const PRIORITY: Record<AutoOrders['upgradeFirst'], BuildingCategory[]> = {
  defences: ['defence'],
  resources: ['resource', 'storage'],
  army: ['army'],
};
const ORDER: BuildingCategory[] = ['defence', 'resource', 'storage', 'army', 'core'];
const SKIP = new Set<BuildingId>(['wall', 'caltrops']);

/** First free spot for a new building, searched outwards from the Citadel. */
function spotFor(layout: AutoLayout, type: BuildingId): { x: number; y: number } | null {
  const occ = occupancy(layout);
  const c = layout.buildings.find((b) => b.type === 'citadel');
  const cx = (c?.x ?? 13) + 2;
  const cy = (c?.y ?? 13) + 2;
  for (let r = 3; r < 16; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(occ, type, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
  return null;
}
type AutoLayout = Parameters<typeof occupancy>[0];

/** Master Mason Orrin upgrades (or builds) by the orders' priority, within the Gold reserve. */
async function masonBuilds(ctx: Ctx, s: AutoSessionDoc) {
  // One refusal per beat is enough to explain why Orrin waits.
  let refused = false;
  for (let job = 0; job < BUILDERS; job++) {
    const { player, base, res } = await loadPlayer(ctx, s.playerId);
    if (Object.keys(base.timers).length >= BUILDERS) return;
    const cl = citadelLevelOf(base.layout);
    const first = PRIORITY[s.orders.upgradeFirst];
    const rank = (cat: BuildingCategory) => (first.includes(cat) ? 0 : 1 + ORDER.indexOf(cat));
    type Job = { kind: 'upgrade' | 'build'; type: BuildingId; id?: string; level: number; cost: ReturnType<typeof buildCost> };
    const jobs: Job[] = [];
    for (const b of base.layout.buildings) {
      if (SKIP.has(b.type) || base.timers[b.id] || b.level >= maxLevelFor(b.type, cl)) continue;
      jobs.push({ kind: 'upgrade', type: b.type, id: b.id, level: b.level + 1, cost: buildCost(b.type, b.level + 1) });
    }
    for (const type of Object.keys(BUILDINGS) as BuildingId[]) {
      if (SKIP.has(type) || type === 'citadel' || BUILDINGS[type].unlockCitadel > cl) continue;
      if (base.layout.buildings.filter((b) => b.type === type).length < limitFor(type, cl)) jobs.push({ kind: 'build', type, level: 1, cost: buildCost(type, 1) });
    }
    jobs.sort((a, b) => rank(BUILDINGS[a.type].category) - rank(BUILDINGS[b.type].category) || a.cost.amount - b.cost.amount);
    const reserve = Math.floor((capacities(base.layout).gold * s.orders.reserveGoldPct) / 100);
    let done = false;
    for (const j of jobs.filter((x) => res[x.cost.resource] >= x.cost.amount).slice(0, 4)) {
      const gold = j.cost.resource === 'gold';
      const name = BUILDINGS[j.type].name;
      const spot = j.kind === 'build' ? spotFor(base.layout, j.type) : null;
      if (j.kind === 'build' && !spot) continue;
      const text = j.kind === 'upgrade' ? `Upgraded ${name} to level ${j.level}` : `Built a new ${name}`;
      const ok = await act(
        ctx,
        s,
        player,
        'architect',
        { kind: j.kind, detail: { type: j.type, buildingId: j.id ?? null, toLevel: j.level, resource: j.cost.resource, cost: j.cost.amount, goldAfter: gold ? res.gold - j.cost.amount : res.gold, reserveGold: gold ? reserve : 0 } },
        j.kind === 'upgrade' ? `upgrade ${name} to level ${j.level} (${fmt(j.cost.amount)} ${j.cost.resource})` : `build a ${name}`,
        async () => {
          if (j.kind === 'upgrade') await upgrade(ctx, s.playerId, j.id!);
          else await build(ctx, s.playerId, j.type, spot!.x, spot!.y);
          return { text };
        },
        refused,
      );
      if (ok) {
        done = true;
        break;
      }
      refused = true;
    }
    if (!done) return;
  }
}

/** Orrin applies the Architect's layout fix once, then re-seals the changed base in the Ledger. */
async function masonSeals(ctx: Ctx, s: AutoSessionDoc) {
  const t = ctx.now();
  const { player, base } = await loadPlayer(ctx, s.playerId);
  if (!s.patched) {
    s.patched = true;
    const patch = base.pendingPatch ?? heuristicPatch(base.layout);
    if (patch && !validatePatch(base.layout, patch.moves)) {
      const n = patch.moves.length;
      const ok = await act(ctx, s, player, 'architect', { kind: 'layout', detail: { moves: patch.moves } }, `Moved ${n} building${n === 1 ? '' : 's'} (the Architect's fix)`, async () => {
        await applyPatch(ctx, s.playerId);
      });
      if (ok) s.changes++;
    }
  }
  const fresh = await loadPlayer(ctx, s.playerId);
  const hash = baseHash(normalizeBase(fresh.base.layout));
  if (fresh.base.sealedHash === hash) return;
  const busy = Object.keys(fresh.base.timers).length > 0;
  if (busy && s.lastSealAt !== null && t - s.lastSealAt < RESEAL_EVERY) return;
  if (!player.burnerKey && ctx.chain.mode === 'live') {
    if (!s.log.some((e) => e.text.startsWith('Orrin needs your wallet')))
      s.log.push(note(t, 'architect', 'Orrin needs your wallet to re-seal — seal the base yourself after Auto Mode.'));
    return;
  }
  const n = Math.max(1, s.changes);
  const ok = await act(ctx, s, player, 'architect', { kind: 'reseal', detail: { baseHash: hash } }, `Base re-sealed after ${n} change${n === 1 ? '' : 's'}`, async () => {
    await sealRelay(ctx, s.playerId, {});
  });
  if (ok) {
    s.changes = 0;
    s.lastSealAt = t;
  }
}

/** Replay a plan exactly as the battle screen would autoplay it (actions applied at their ticks). */
function playPlan(input: BattleInput): BattleInput {
  const b = createBattle({ ...input, actions: [] });
  const queue = [...input.actions];
  while (!b.ended) {
    const now = queue.filter((a) => a.t === b.tick);
    queue.splice(0, now.length);
    step(b, now);
  }
  return { ...input, actions: b.applied };
}

/** Captain Sefa picks a target, runs the War Room (150 practice raids) and raids if the orders allow. */
async function strategistRaids(ctx: Ctx, s: AutoSessionDoc) {
  const o = s.orders;
  if (!o.raidsPerHour) return;
  const t = ctx.now();
  const recent = s.raidTimes.filter((x) => x > t - 3_600_000);
  const last = s.raidTimes.length ? s.raidTimes[s.raidTimes.length - 1]! : null;
  if (last !== null && t - last < 3_600_000 / o.raidsPerHour) return;
  const { player, base } = await loadPlayer(ctx, s.playerId);
  // Rival lords only: the officers never raid a friend on their own.
  const targets = (await listTargets(ctx, s.playerId)).filter((x) => x.sealed && !x.friend);
  const rankD = { hard: 0, medium: 1, easy: 2 } as const;
  const order = [...targets].sort((a, b) => Number(b.recommended) - Number(a.recommended) || rankD[a.difficulty] - rankD[b.difficulty]);
  const key = (islandId: string) => `${islandId}|${armyCapacity(base.layout)}|${troopLevel(base.layout)}`;
  for (const target of order.slice(0, 3)) {
    let roomId = s.rooms[key(target.islandId)];
    let room = roomId ? await ctx.repo.warRooms.get(roomId) : undefined;
    if (!room || room.status !== 'ready') {
      const dto = await createWarRoom(ctx, s.playerId, target.islandId, true);
      roomId = dto.warRoomId;
      s.rooms[key(target.islandId)] = roomId;
      room = await ctx.repo.warRooms.get(roomId);
    }
    if (!room) continue;
    const { res } = await loadPlayer(ctx, s.playerId);
    const plans = room.plans.filter((p) => p.stats && res.timber >= p.cost.timber && res.ember >= p.cost.ember);
    if (!plans.length) {
      const cheapest = [...room.plans].sort((a, b) => a.cost.timber - b.cost.timber)[0];
      const msg = `Sefa: the cheapest army for ${target.name} costs ${fmt(cheapest?.cost.timber ?? 0)} Timber — we have ${fmt(res.timber)}.`;
      if (!s.log.slice(-12).some((e) => e.text === msg)) s.log.push(note(t, 'strategist', msg));
      continue;
    }
    const best = plans.sort((a, b) => b.stats!.winRate - a.stats!.winRate || b.stats!.avgStars - a.stats!.avgStars || a.stats!.avgSeconds - b.stats!.avgSeconds)[0]!;
    const winPct = Math.round(best.stats!.winRate);
    const ok = await act(
      ctx,
      s,
      player,
      'strategist',
      { kind: 'raid', detail: { islandId: target.islandId, planId: best.planId, winPct, raidsLastHour: recent.length } },
      `raid on ${target.name} with the ${best.name}`,
      async () => {
        const c = await commitBattle(ctx, s.playerId, roomId!, best.planId);
        const input = playPlan({ engineVersion: c.engineVersion ?? 1, seed: c.seed, base: c.base, army: c.army, actions: c.plan.actions });
        const r = await submitBattle(ctx, s.playerId, c.battleId, bytesToBase64(encodeReplay(input)));
        if (!r.verified || !r.result) return { text: `Raided ${target.name} — replay rejected`, battleId: c.battleId };
        return { text: `Raided ${target.name} — ${r.result.stars}★, ${Math.round(r.result.destructionPct)}% · Verified ✓`, battleId: c.battleId };
      },
    );
    if (ok) {
      s.raidTimes.push(t);
      s.raidTimes = s.raidTimes.slice(-20);
      return;
    }
  }
}

/** Watch-Captain Hale: holds the walls when rival raiders come, then repairs, strikes back and shields. */
async function captainDefends(ctx: Ctx, s: AutoSessionDoc) {
  const minute = s.beat * AUTO_BEAT_MINUTES;
  if (minute < RAID_IN_AT || (minute - RAID_IN_AT) % RAID_IN_EVERY !== 0) return;
  const t = ctx.now();
  const { player, base, res } = await loadPlayer(ctx, s.playerId);
  const lords = await rivalLords(ctx);
  if (!lords.length) return;
  const npc = lords[(s.chainId + s.beat) % lords.length]!;
  const island = await ctx.repo.islands.get(npc.npcKey!);
  const who = island?.ownerName ?? 'Raiders';
  if (res.shieldUntil > t) {
    s.log.push(note(t, 'night_captain', `${who}'s raiders turned back at the storm-shield.`));
    return;
  }
  const seal = await ctx.chain.sealOf(player.address);
  if (!base.sealedHash || !seal || seal.baseHash.toLowerCase() !== base.sealedHash.toLowerCase()) {
    s.log.push(note(t, 'night_captain', `${who}'s scouts found no sealed base to judge a raid against.`));
    return;
  }
  const raid = await raidHoldfast(ctx, { playerId: s.playerId, player, base, res, npc, planIndex: s.beat, reserveGoldPct: s.orders.reserveGoldPct });
  const a = raid.attack;
  const verdict = a.stars <= 1 ? 'the walls held' : 'they broke through';
  s.log.push({ ...note(t, 'night_captain', `${who}'s raiders struck: ${a.stars}★, ${Math.round(a.destructionPct)}% — ${verdict}.`, a.resultTx), battleId: raid.battleId });
  if (raid.goldLoss > raid.takenGold) s.log.push(note(t, 'night_captain', `The reserve kept ${fmt(raid.goldLoss - raid.takenGold)} Gold out of their reach.`));
  if (raid.destructionBp > 0) {
    const what = s.orders.upgradeFirst === 'resources' ? 'storehouses' : s.orders.upgradeFirst === 'army' ? 'barracks' : 'defences';
    await act(ctx, s, player, 'night_captain', { kind: 'repair', detail: { attackId: raid.battleId, first: what } }, `Repaired the damage, ${what} first`, async () => {});
  }
  await act(
    ctx,
    s,
    player,
    'night_captain',
    { kind: 'strikeback', detail: { attackId: raid.battleId, target: npc.npcKey } },
    `strike back at ${who}'s camp`,
    async () => {
      res.renown += 3;
      return { text: `Struck back at ${who}'s camp (+3 Renown)` };
    },
  );
  if (a.destructionPct >= s.orders.shieldAtPct)
    await act(ctx, s, player, 'night_captain', { kind: 'shield', detail: { attackId: raid.battleId, lossPct: Math.round(a.destructionPct) } }, `Raised the storm-shield after losing ${Math.round(a.destructionPct)}%`, async () => {
      res.shieldUntil = Math.max(res.shieldUntil ?? 0, t + SHIELD_HOURS * 3_600_000);
    });
  clampToCaps(res, base.layout);
  await ctx.repo.resources.put(res);
}

// ----------------------------------------------------------------------- scheduler ---

/** Runs due beats for every running session (server: always; offline realm: while the app is open). */
export class AutoRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  constructor(
    private readonly ctx: Ctx,
    private readonly everyMs = 15_000,
  ) {}
  start() {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), this.everyMs);
    (this.timer as { unref?: () => void }).unref?.();
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  async tick() {
    const running = await this.ctx.repo.autoSessions.find((s) => s.status === 'running');
    await Promise.all(running.map((s) => advanceAuto(this.ctx, s.playerId)));
  }
}
