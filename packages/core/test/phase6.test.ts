import { afterEach, describe, expect, it } from 'vitest';
import { bytesToBase64, createBattle, encodeReplay, step, ENGINE_VERSION, type BattleInput } from '@realm/battle-engine';
import { AUTO_GEMS_PER_BLOCK, GEM_REWARDS, STARTING_GEMS, autoCost } from '@realm/game-data';
import {
  AUTO_BLOCKED,
  AUTO_SESSION_BASE,
  DEFAULT_AUTO_ORDERS,
  autoOrdersHash,
  isAutoActionAllowed,
  type AutoOrders,
  type AutoSessionDTO,
  type BattleCommitDTO,
  type BattleSubmitDTO,
  type GemsDTO,
  type HomeDTO,
  type WarRoomDTO,
} from '@realm/shared';
import { FallbackAgents, MemoryBus, MemoryRepo, MockChain, advanceAuto, createCore, inlineSims, type ChainEvent, type Core } from '../src';

const MIN = 60_000;
const cores: Core[] = [];
afterEach(() => cores.splice(0).forEach((c) => c.stop()));

/** A whole realm on the mock chain with a clock the test moves by hand. */
async function realm(start = Date.UTC(2026, 10, 4, 9, 0, 0)) {
  const clock = { t: start };
  const now = () => clock.t;
  const chain = new MockChain(10143, { now });
  const events: ChainEvent[] = [];
  chain.onEvent((e) => events.push(e));
  const core = createCore({
    repo: new MemoryRepo(),
    chain,
    agents: new FallbackAgents(),
    sims: inlineSims(),
    bus: new MemoryBus(),
    files: { putPortrait: async (id) => `mem://portrait/${id}.png` },
    cfg: { publicBaseUrl: 'http://test', allowDemoAuth: true, demo: true },
    now,
    log: () => {},
  });
  cores.push(core);
  await core.start();
  core.auto.stop(); // the test drives the beats itself
  const { playerId } = (await core.handle('POST', '/auth/demo', {}, null)) as { playerId: string };
  const call = <T>(method: string, path: string, body?: unknown) => core.handle(method, path, body, playerId) as Promise<T>;
  return { core, clock, chain, events, playerId, call };
}

type Realm = Awaited<ReturnType<typeof realm>>;

async function startAuto(r: Realm, minutes: AutoOrders['minutes'], orders: Partial<typeof DEFAULT_AUTO_ORDERS> = {}) {
  const prep = await r.call<{ nightId: number; policyHash: string }>('POST', '/auto/prepare', { minutes, orders: { ...DEFAULT_AUTO_ORDERS, ...orders } });
  return { prep, session: await r.call<AutoSessionDTO>('POST', '/auto/confirm', {}) };
}

/** Move the clock forward, running due beats as the scheduler would every few minutes. */
async function live(r: Realm, minutes: number, every = 5) {
  for (let m = 0; m < minutes; m += every) {
    await advanceAuto(r.core.ctx, r.playerId);
    r.clock.t += every * MIN;
  }
  await advanceAuto(r.core.ctx, r.playerId);
}

const auto = (r: Realm) => r.call<{ session: AutoSessionDTO }>('GET', '/auto').then((x) => x.session);
const gems = (r: Realm) => r.call<GemsDTO>('GET', '/gems');

function playPlan(c: BattleCommitDTO): BattleInput {
  const input: BattleInput = { engineVersion: c.engineVersion ?? ENGINE_VERSION, seed: c.seed, base: c.base, army: c.army, actions: c.plan.actions };
  const s = createBattle({ ...input, actions: [] });
  const q = [...c.plan.actions];
  while (!s.ended) {
    const now = q.filter((a) => a.t === s.tick);
    q.splice(0, now.length);
    step(s, now);
  }
  return { ...input, actions: s.applied };
}

describe('Gems (spec F7)', () => {
  it('start with 50, +2 for the first visit of each UTC day (once), every change in the history', async () => {
    const r = await realm();
    const h1 = await r.call<HomeDTO>('GET', '/home');
    expect(h1.economy.gems).toBe(STARTING_GEMS + GEM_REWARDS.dailyLogin);
    const h2 = await r.call<HomeDTO>('GET', '/home');
    expect(h2.economy.gems).toBe(STARTING_GEMS + GEM_REWARDS.dailyLogin);
    r.clock.t += 24 * 60 * MIN;
    const h3 = await r.call<HomeDTO>('GET', '/home');
    expect(h3.economy.gems).toBe(STARTING_GEMS + 2 * GEM_REWARDS.dailyLogin);
    const g = await gems(r);
    expect(g.balance).toBe(h3.economy.gems);
    expect(g.history.filter((x) => x.label === 'Daily login')).toHaveLength(2);
    expect(g.history.at(-1)).toMatchObject({ label: 'Starting Gems', delta: 50 });
  });

  it('a verified raid pays "First raid today" once a day, +3 for three stars, +10 per new badge', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    const before = (await gems(r)).balance;
    const w = await r.call<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'briarholt' });
    for (let i = 0; i < 400 && (await r.call<{ status: string }>('GET', `/warroom/${w.warRoomId}`)).status !== 'ready'; i++) await new Promise((x) => setTimeout(x, 20));
    const raid = async () => {
      const c = await r.call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: w.warRoomId, planId: 'shieldwall' });
      return r.call<BattleSubmitDTO>('POST', `/battle/${c.battleId}/submit`, { replay: bytesToBase64(encodeReplay(playPlan(c))) });
    };
    const first = await raid();
    expect(first.verified).toBe(true);
    expect(first.result!.stars).toBe(3);
    expect(first.gems).toEqual([
      { delta: GEM_REWARDS.firstRaid, label: 'First raid today' },
      { delta: GEM_REWARDS.threeStar, label: '3-star raid' },
    ]);
    const badges = first.badges.length;
    expect(badges).toBeGreaterThanOrEqual(2); // first raid + three stars
    const after = (await gems(r)).balance;
    expect(after - before).toBe(GEM_REWARDS.firstRaid + GEM_REWARDS.threeStar + badges * GEM_REWARDS.badge);
    const second = await raid();
    expect(second.gems).toEqual([{ delta: GEM_REWARDS.threeStar, label: '3-star raid' }]);
    const labels = (await gems(r)).history.map((x) => x.label);
    expect(labels).toContain('First raid today');
    expect(labels).toContain('3-star raid on Briarholt');
    expect(labels.some((l) => l.startsWith('New badge:'))).toBe(true);
  }, 60_000);
});

describe('Auto Orders (spec F8)', () => {
  it('the gate: raids need the win chance and stay under the hourly cap; spending keeps the Gold reserve', () => {
    const o = { ...DEFAULT_AUTO_ORDERS, v: 1, kind: 'auto', session: AUTO_SESSION_BASE + 1, minutes: 60 } as AutoOrders;
    expect(isAutoActionAllowed(o, { kind: 'raid', detail: { winPct: 48, raidsLastHour: 0 } })).toEqual({ ok: false, reason: 'win chance 48%, orders need 70%' });
    expect(isAutoActionAllowed(o, { kind: 'raid', detail: { winPct: 92, raidsLastHour: 0 } }).ok).toBe(true);
    expect(isAutoActionAllowed(o, { kind: 'raid', detail: { winPct: 92, raidsLastHour: 2 } }).ok).toBe(false);
    expect(isAutoActionAllowed(o, { kind: 'upgrade', detail: { goldAfter: 420, reserveGold: 600 } })).toEqual({ ok: false, reason: 'would leave 420 Gold, orders keep 600' });
    expect(isAutoActionAllowed({ ...o, strikeBack: false }, { kind: 'strikeback', detail: {} }).ok).toBe(false);
    expect(isAutoActionAllowed(o, { kind: 'shield', detail: { lossPct: 59 } }).ok).toBe(false);
    expect(autoCost(30)).toBe(2);
    expect(autoCost(480)).toBe(32);
  });

  it('orders are sealed on chain under their own id (never a night id), the first block is paid, manual play pauses', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    const g0 = (await gems(r)).balance;
    const { prep, session } = await startAuto(r, 60);
    expect(prep.nightId).toBeGreaterThanOrEqual(AUTO_SESSION_BASE);
    expect(session.status).toBe('running');
    expect(session.ordersHash).toBe(autoOrdersHash(session.orders));
    const sealed = r.events.find((e) => e.name === 'PolicyCommitted');
    expect(sealed?.args).toMatchObject({ nightId: prep.nightId, policyHash: session.ordersHash });
    expect((await gems(r)).balance).toBe(g0 - AUTO_GEMS_PER_BLOCK);
    const home = await r.call<HomeDTO>('GET', '/home');
    expect(home.auto).toMatchObject({ status: 'running', endsAt: session.startedAt + 60 * MIN });
    await expect(r.call('POST', '/base/upgrade', { buildingId: home.base.layout.buildings[0]!.id })).rejects.toThrow(AUTO_BLOCKED);
    await expect(r.call('POST', '/warroom', { targetIslandId: 'briarholt' })).rejects.toThrow(AUTO_BLOCKED);
    await expect(r.call('POST', '/auto/prepare', { minutes: 30, orders: DEFAULT_AUTO_ORDERS })).rejects.toThrow(/already running/);
  });

  it('an hour of officers: collect, upgrade, re-seal, War Room raids and Hale on defence — every move in the Ledger', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    await r.call('POST', '/base/seal/relay', {});
    const g0 = (await gems(r)).balance;
    const { session } = await startAuto(r, 60);
    await live(r, 61);
    const s = (await auto(r))!;
    expect(s.status).toBe('finished');
    const ok = s.log.filter((e) => e.kind !== 'note' && e.allowed);
    const kinds = new Set(ok.map((e) => e.kind));
    for (const k of ['collect', 'upgrade', 'reseal', 'raid'] as const) expect(kinds, k).toContain(k);
    expect(s.log.some((e) => /raiders struck/.test(e.text))).toBe(true);
    expect(ok.find((e) => e.kind === 'raid')!.text).toMatch(/^Raided .+ — \d★, \d+% · Verified ✓$/);
    expect(ok.find((e) => e.kind === 'collect')!.text).toMatch(/^Collected [\d,]+ (Gold|Timber|Ember)/);
    expect(s.moves).toBe(ok.length);
    // Each move was logged on chain with this session's id and the sealed orders' hash.
    const logged = r.events.filter((e) => e.name === 'AutopilotAction');
    expect(logged).toHaveLength(ok.length);
    expect(logged.every((e) => e.args.nightId === session.orders.session && e.args.policyHash === session.ordersHash)).toBe(true);
    // Two 30-minute blocks, one history row.
    expect(s.gemsSpent).toBe(4);
    const g = await gems(r);
    expect(g.history.find((x) => x.label === 'Auto Mode 1 hour')).toMatchObject({ delta: -4 });
    // The officers' raid earned its own Gems (first raid today) on top.
    expect(g.balance).toBeGreaterThan(g0 - 4);
    // The end is shown once on Home, then it is seen.
    const home = await r.call<HomeDTO>('GET', '/home');
    expect(home.auto).toBeNull();
    expect(home.events.some((e) => e.title === 'Auto Mode finished')).toBe(true);
    // Manual play is back.
    await expect(r.call('POST', '/base/seal/prepare')).resolves.toBeTruthy();
  }, 240_000);

  it('a reserve the treasury can’t keep is refused (✗ in the Auto Log), nothing is spent on Gold', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    // Enough Gold for the Citadel (1,600) but not enough to keep 80% of the 6,500 storage.
    const res = (await r.core.ctx.repo.resources.get(r.playerId))!;
    res.gold = 4000;
    await r.core.ctx.repo.resources.put(res);
    await startAuto(r, 30, { reserveGoldPct: 80, raidsPerHour: 0, upgradeFirst: 'defences' });
    await advanceAuto(r.core.ctx, r.playerId);
    const s = (await auto(r))!;
    const refused = s.log.filter((e) => !e.allowed && (e.kind === 'upgrade' || e.kind === 'build'));
    expect(refused.length).toBeGreaterThan(0);
    expect(refused[0]!.text).toBe('Refused: build a Bowyer Tower');
    expect(refused[0]!.reason).toBe('would leave 3750 Gold, orders keep 5200');
    expect((await r.core.ctx.repo.resources.get(r.playerId))!.gold).toBe(4000);
  }, 60_000);

  it('out of Gems: Auto Mode turns itself off when the next block can’t be paid', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    const { session } = await startAuto(r, 120, { raidsPerHour: 0 });
    await advanceAuto(r.core.ctx, r.playerId); // beat 0 (its badges pay Gems too)
    const res = (await r.core.ctx.repo.resources.get(r.playerId))!;
    res.gems = 1;
    await r.core.ctx.repo.resources.put(res);
    await live(r, 40);
    const s = (await auto(r))!;
    expect(s.status).toBe('out_of_gems');
    expect(s.endedAt).toBe(session.startedAt + 30 * MIN);
    expect(s.gemsSpent).toBe(2);
    expect(s.log.at(-1)!.text).toBe('Out of Gems — Auto Mode stopped.');
    expect((await gems(r)).balance).toBe(1);
  }, 120_000);

  it('TAKE CONTROL stops at once; the running block is not refunded', async () => {
    const r = await realm();
    await r.call('GET', '/home');
    await startAuto(r, 240, { raidsPerHour: 0 });
    await advanceAuto(r.core.ctx, r.playerId); // beat 0 is done (its badges pay Gems too)
    const g1 = (await gems(r)).balance;
    const { session } = await r.call<{ session: AutoSessionDTO }>('POST', '/auto/stop');
    expect(session.status).toBe('stopped');
    r.clock.t += 60 * MIN;
    await advanceAuto(r.core.ctx, r.playerId);
    expect((await auto(r))!.status).toBe('stopped');
    expect((await gems(r)).balance).toBe(g1);
    await expect(r.call('POST', '/base/seal/prepare')).resolves.toBeTruthy();
  }, 60_000);

  it('a resumed offline realm catches up on exactly the beats a live one ran', async () => {
    const run = async (catchUp: boolean) => {
      const r = await realm();
      await r.call('GET', '/home');
      await startAuto(r, 30, { raidsPerHour: 0, upgradeFirst: 'resources' });
      if (catchUp) {
        r.clock.t += 3 * 60 * MIN; // the phone was closed for 3 hours
        await advanceAuto(r.core.ctx, r.playerId);
      } else await live(r, 31);
      const s = (await auto(r))!;
      return { status: s.status, endedAt: s.endedAt! - s.startedAt, log: s.log.filter((e) => e.officer === 'general' || e.officer === 'architect').map((e) => `${e.at - s.startedAt}|${e.kind}|${e.allowed}|${e.text}`) };
    };
    const a = await run(false);
    const b = await run(true);
    expect(b.status).toBe('finished');
    expect(b.endedAt).toBe(30 * MIN);
    expect(b.log).toEqual(a.log);
    expect(a.log.length).toBeGreaterThan(3);
  }, 120_000);
});
