import { afterEach, describe, expect, it } from 'vitest';
import { bytesToBase64, createBattle, encodeReplay, simulate, step, type BattleInput } from '@realm/battle-engine';
import { GEM_REWARDS } from '@realm/game-data';
import {
  channels,
  defaultAppearance,
  type BattleCommitDTO,
  type BattleSubmitDTO,
  type DuelDTO,
  type LobbyDTO,
  type SpectateDTO,
  type TargetDTO,
  type WarRoomDTO,
} from '@realm/shared';
import { FallbackAgents, MemoryBus, MemoryRepo, MockChain, NO_HOST, RECONNECT_MS, createCore, inlineSims, type ChainEvent, type Core } from '../src';

const cores: Core[] = [];
afterEach(() => cores.splice(0).forEach((c) => c.stop()));

/** One LAN host (room KRAG) and two phones, each with its own commander. */
async function room(lan: { room: string; hostName: string } | null = { room: 'KRAG', hostName: "Ayaan's laptop" }) {
  const clock = { t: Date.UTC(2026, 10, 4, 18) };
  const now = () => clock.t;
  const chain = new MockChain(10143, { now });
  const events: ChainEvent[] = [];
  chain.onEvent((e) => events.push(e));
  const bus = new MemoryBus();
  const core = createCore({
    repo: new MemoryRepo(),
    chain,
    agents: new FallbackAgents(),
    sims: inlineSims(),
    bus,
    files: { putPortrait: async (id) => `mem://${id}.png` },
    cfg: { publicBaseUrl: 'http://test', allowDemoAuth: true, demo: true, lan },
    now,
    log: () => {},
  });
  cores.push(core);
  await core.start();
  core.auto.stop();
  core.lan.stop(); // the test runs the duel clock itself
  const phone = async (deviceId: string, name: string) => {
    const { playerId } = (await core.handle('POST', '/auth/demo', { deviceId }, null)) as { playerId: string };
    const call = <T>(method: string, path: string, body?: unknown) => core.handle(method, path, body, playerId) as Promise<T>;
    await call('PUT', '/general', { name, personality: 'bold', faction: 'thornmarch', appearance: defaultAppearance('thornmarch') });
    return { playerId, call };
  };
  const heard: { ch: string; t: string; d: any }[] = [];
  const listen = (ch: string) => bus.subscribe(ch, ((m: { t: string; d: unknown }) => heard.push({ ch, t: m.t, d: m.d })) as never);
  return { core, clock, chain, events, bus, phone, heard, listen };
}

async function ready(call: <T>(m: string, p: string, b?: unknown) => Promise<T>, id: string) {
  for (let i = 0; i < 400; i++) {
    const w = await call<WarRoomDTO & { status: string }>('GET', `/warroom/${id}`);
    if (w.status === 'ready') return w;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('war room never finished');
}

/** Drive the plan like the battle screen, keeping the actions as they were applied. */
function play(c: BattleCommitDTO): BattleInput {
  const input: BattleInput = { engineVersion: c.engineVersion, seed: c.seed, base: c.base, army: c.army, actions: c.plan.actions };
  const s = createBattle({ ...input, actions: [] });
  const q = [...c.plan.actions];
  while (!s.ended) {
    const now = q.filter((a) => a.t === s.tick);
    q.splice(0, now.length);
    step(s, now);
  }
  return { ...input, actions: s.applied };
}

describe('Play with Friends (spec F9)', () => {
  it('each phone keeps its own commander; the room code is checked; lobby, READY and emotes', async () => {
    const r = await room();
    const a = await r.phone('phone-aaaa-1111', 'Ayaan');
    const again = (await r.core.handle('POST', '/auth/demo', { deviceId: 'phone-aaaa-1111' }, null)) as { playerId: string; isNew: boolean };
    expect(again).toMatchObject({ playerId: a.playerId, isNew: false });
    const b = await r.phone('phone-bbbb-2222', 'Brannoc');
    expect(b.playerId).not.toBe(a.playerId);
    await expect(a.call('POST', '/lan/join', { code: 'NOPE' })).rejects.toThrow(/room code/);
    await a.call('POST', '/lan/join', { code: 'krag' });
    const lobby = await b.call<LobbyDTO>('POST', '/lan/join', { code: 'KRAG' });
    expect(lobby.room).toBe('KRAG');
    expect(lobby.hostName).toBe("Ayaan's laptop");
    expect(lobby.players.map((p) => p.name)).toEqual(['Ayaan', 'Brannoc']);
    expect(lobby.players.every((p) => p.status === 'island' && !p.ready)).toBe(true);
    r.listen(channels.lobby());
    await a.call('POST', '/lan/ready', { ready: true });
    await b.call('POST', '/lan/emote', { emote: 'good_luck' });
    expect(r.heard.find((h) => h.t === 'emote')?.d).toMatchObject({ name: 'Brannoc', text: 'Good luck!' });
    expect((await b.call<LobbyDTO>('GET', '/lan/lobby')).players.find((p) => p.name === 'Ayaan')!.ready).toBe(true);
    // The public info used by the Wi-Fi scan never carries the code.
    expect(await r.core.handle('GET', '/lan/info', undefined, null)).toEqual({ lan: true, hostName: "Ayaan's laptop", players: 2 });
  });

  it('offline realm: "Play with Friends needs a host on your Wi-Fi."', async () => {
    const r = await room(null);
    const a = await r.phone('phone-solo-0001', 'Solo');
    await expect(a.call('POST', '/lan/join', { code: 'KRAG' })).rejects.toThrow(NO_HOST);
    expect(await r.core.handle('GET', '/lan/info', undefined, null)).toMatchObject({ lan: false });
  });

  it("raid your friend: their sealed base is a target, they get the alert, watch it live, and lose the loot", async () => {
    const r = await room();
    const a = await r.phone('phone-aaaa-1111', 'Ayaan');
    const b = await r.phone('phone-bbbb-2222', 'Brannoc');
    for (const p of [a, b]) await p.call('POST', '/lan/join', { code: 'KRAG' });
    // Not sealed → not a raidable target yet.
    expect((await a.call<{ islands: TargetDTO[] }>('GET', '/targets')).islands.some((t) => t.friend)).toBe(false);
    await b.call('POST', '/base/seal/relay', {});
    const t = (await a.call<{ islands: TargetDTO[] }>('GET', '/targets')).islands.find((x) => x.friend)!;
    expect(t).toMatchObject({ islandId: `p:${b.playerId}`, name: "Brannoc's holdfast", sealed: true, friend: true });
    r.listen(channels.player(b.playerId));
    const w = await a.call<WarRoomDTO>('POST', '/warroom', { targetIslandId: t.islandId });
    const room1 = await ready(a.call, w.warRoomId);
    const c = await a.call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room1.warRoomId, planId: 'shieldwall' });
    expect(c.live).toBe(true);
    expect(r.heard.find((h) => h.t === 'raid-alert')?.d).toMatchObject({ battleId: c.battleId, text: 'Ayaan is raiding you!' });
    // The attacker streams what it applied; the defender's phone rebuilds the battle from it.
    const input = play(c);
    r.listen(channels.battle(c.battleId));
    for (let tick = 0; tick <= 1800; tick += 10) r.core.lan.live(a.playerId, c.battleId, tick, input.actions.filter((x) => x.t >= tick && x.t < tick + 10));
    r.core.lan.live(b.playerId, c.battleId, 1800, [{ kind: 'rally', t: 1 }]); // not the attacker: ignored
    const watch = await b.call<SpectateDTO>('GET', `/battle/${c.battleId}/spectate`);
    expect(watch.actions).toEqual(input.actions);
    const mirror = simulate({ ...watch.input, actions: watch.actions });
    const gold0 = (await r.core.ctx.repo.resources.get(b.playerId))!.gold;
    const sub = await a.call<BattleSubmitDTO>('POST', `/battle/${c.battleId}/submit`, { replay: bytesToBase64(encodeReplay(input)) });
    expect(sub.verified).toBe(true);
    expect(mirror.stars).toBe(sub.result!.stars);
    expect(mirror.destructionBp).toBe(sub.result!.destructionBp);
    expect(r.heard.find((h) => h.t === 'live-end')?.d).toMatchObject({ stars: sub.result!.stars });
    const def = (await r.core.ctx.repo.resources.get(b.playerId))!;
    expect(def.gold).toBe(Math.max(0, gold0 - sub.result!.loot.gold));
    expect(def.events[0]!.title).toMatch(/^Ayaan raided you/);
  }, 120_000);

  it('Live Duel: one shared seed, both replays re-simulated, winner by stars → % → time, recorded on RealmDuels', async () => {
    const r = await room();
    const a = await r.phone('phone-aaaa-1111', 'Ayaan');
    const b = await r.phone('phone-bbbb-2222', 'Brannoc');
    for (const p of [a, b]) await p.call('POST', '/lan/join', { code: 'KRAG' });
    r.listen(channels.player(b.playerId));
    const inv = await a.call<DuelDTO>('POST', '/duel/invite', { to: b.playerId });
    expect(r.heard.find((h) => h.t === 'duel-invite')?.d.text).toBe('Ayaan challenges you to a Live Duel!');
    await expect(b.call('POST', `/duel/${inv.duelId}/accept`)).rejects.toThrow(/must seal their base/);
    for (const p of [a, b]) await p.call('POST', '/base/seal/relay', {});
    const commitsBefore = r.events.filter((e) => e.name === 'BattleCommitted').length;
    const live = await b.call<DuelDTO>('POST', `/duel/${inv.duelId}/accept`);
    expect(live.status).toBe('live');
    expect(live.endsAt - live.startsAt).toBe(180_000);
    expect(r.events.filter((e) => e.name === 'BattleCommitted').length - commitsBefore).toBe(1); // ONE seed
    const subs: BattleSubmitDTO[] = [];
    const seeds: string[] = [];
    for (const [p, side] of [
      [a, live.a],
      [b, live.b],
    ] as const) {
      const w = await ready(p.call, side.warRoomId!);
      expect(w.target.islandId).toBe(`p:${(p === a ? b : a).playerId}`);
      const c = await p.call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: w.warRoomId, planId: 'shieldwall', duelId: live.duelId });
      seeds.push(c.seed);
      r.core.lan.progress(p.playerId, live.duelId, 1, 40);
      subs.push(await p.call<BattleSubmitDTO>('POST', `/battle/${c.battleId}/submit`, { replay: bytesToBase64(encodeReplay(play(c))) }));
    }
    expect(seeds[0]).toBe(seeds[1]);
    expect(subs.every((s) => s.verified && s.result!.renown === 0 && s.result!.loot.gold === 0)).toBe(true);
    const done = subs[1]!.duel!;
    expect(done.status).toBe('decided');
    expect(done.decidedBy).toBe('replays');
    const [ra, rb] = subs.map((s) => s.result!);
    const want =
      ra!.stars !== rb!.stars ? (ra!.stars > rb!.stars ? a.playerId : b.playerId) : ra!.destructionBp !== rb!.destructionBp ? (ra!.destructionBp > rb!.destructionBp ? a.playerId : b.playerId) : null;
    if (want) expect(done.winner).toBe(want);
    expect(done.resultTx).toBeTruthy();
    expect(r.events.some((e) => e.name === 'DuelRecorded')).toBe(true);
    if (done.winner && done.winner !== 'draw') {
      const g = await (done.winner === a.playerId ? a : b).call<{ history: { label: string; delta: number }[] }>('GET', '/gems');
      expect(g.history.find((x) => x.label === 'Won a friend duel')).toMatchObject({ delta: GEM_REWARDS.duelWin });
    }
  }, 180_000);

  it('a dropped commander has 20 s to come back, then the duel is decided by the replays received', async () => {
    const r = await room();
    const a = await r.phone('phone-aaaa-1111', 'Ayaan');
    const b = await r.phone('phone-bbbb-2222', 'Brannoc');
    for (const p of [a, b]) await p.call('POST', '/lan/join', { code: 'KRAG' });
    for (const p of [a, b]) await p.call('POST', '/base/seal/relay', {});
    r.core.lan.online(a.playerId);
    r.core.lan.online(b.playerId);
    const inv = await a.call<DuelDTO>('POST', '/duel/invite', { to: b.playerId });
    const live = await b.call<DuelDTO>('POST', `/duel/${inv.duelId}/accept`);
    r.listen(channels.duel(live.duelId));
    const w = await ready(a.call, live.a.warRoomId!);
    const c = await a.call<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: w.warRoomId, planId: 'shieldwall', duelId: live.duelId });
    await a.call('POST', `/battle/${c.battleId}/submit`, { replay: bytesToBase64(encodeReplay(play(c))) });
    r.core.lan.offline(b.playerId);
    expect(r.heard.find((h) => h.t === 'duel-wait')?.d).toMatchObject({ name: 'Brannoc' });
    r.clock.t += RECONNECT_MS - 1000;
    await r.core.lan.tick();
    expect((await a.call<DuelDTO>('GET', `/duel/${live.duelId}`)).status).toBe('live');
    r.clock.t += 2000;
    await r.core.lan.tick();
    const d = await a.call<DuelDTO>('GET', `/duel/${live.duelId}`);
    expect(d).toMatchObject({ status: 'decided', decidedBy: 'disconnect', winner: a.playerId });
  }, 180_000);
});

describe('room hygiene', () => {
  it('a commander offline for 10 minutes leaves the listing (and can join again)', async () => {
    const r = await room();
    const a = await r.phone('phone-aaaa-1111', 'Ayaan');
    const b = await r.phone('phone-bbbb-2222', 'Brannoc');
    for (const p of [a, b]) await p.call('POST', '/lan/join', { code: 'KRAG' });
    r.core.lan.online(a.playerId);
    r.clock.t += 11 * 60_000;
    await r.core.lan.tick();
    expect((await a.call<LobbyDTO>('GET', '/lan/lobby')).players.map((p) => p.name)).toEqual(['Ayaan']);
    await b.call('POST', '/lan/join', { code: 'KRAG' });
    expect((await a.call<LobbyDTO>('GET', '/lan/lobby')).players).toHaveLength(2);
  });
});
