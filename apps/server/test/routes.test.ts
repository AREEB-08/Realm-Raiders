import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bytesToBase64, createBattle, encodeReplay, step, ENGINE_VERSION } from '@realm/battle-engine';
import { defaultAppearance, type BattleCommitDTO, type HomeDTO, type WarRoomDTO } from '@realm/shared';
import { buildApp, type BuiltApp } from '../src/app';

let built: BuiltApp;
let auth: Record<string, string>;

const inject = async <T>(method: 'GET' | 'POST' | 'PUT', url: string, payload?: unknown, headers = auth) => {
  const res = await built.app.inject({ method, url, payload: payload as never, headers });
  return { status: res.statusCode, body: res.json() as T };
};

beforeAll(async () => {
  built = await buildApp({ DB_FILE: ':memory:', QUIET: '1', CHAIN_MODE: 'mock', AGENTS_MODE: 'offline', ALLOW_DEMO_AUTH: '1' });
  await built.core.start();
  const res = await built.app.inject({ method: 'POST', url: '/auth/demo' });
  auth = { authorization: `Bearer ${res.json().session}` };
});
afterAll(async () => built.close());

describe('server routes (fastify.inject, mock chain, offline agents)', () => {
  it('GET /health reports db + chain', async () => {
    const r = await inject<{ ok: boolean; chain: { mode: string } }>('GET', '/health', undefined, {});
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.chain.mode).toBe('mock');
  });

  it('rejects requests without a session', async () => {
    expect((await inject('GET', '/home', undefined, {})).status).toBe(401);
    expect((await inject('GET', '/home', undefined, { authorization: 'Bearer nope' })).status).toBe(401);
  });

  it('validates bodies with zod', async () => {
    const r = await inject('PUT', '/general', { name: 'x' });
    expect(r.status).toBe(400);
  });

  it('GET /home and POST /home/collect', async () => {
    const home = await inject<HomeDTO>('GET', '/home');
    expect(home.status).toBe(200);
    const producer = home.body.economy.producers[0]!;
    const c = await inject<{ collected: number }>('POST', '/home/collect', { buildingId: producer.buildingId });
    expect(c.status).toBe(200);
  });

  it('runs the raid loop end to end over HTTP', async () => {
    await inject('PUT', '/general', { name: 'Ysolt', personality: 'cunning', faction: 'skyrend', appearance: defaultAppearance('skyrend') });
    expect((await inject('POST', '/base/seal/relay', {})).status).toBe(200);
    const targets = await inject<{ islands: { islandId: string }[] }>('GET', '/targets');
    expect(targets.body.islands).toHaveLength(3);
    const w = await inject<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'briarholt' });
    let room = w.body as WarRoomDTO & { status?: string };
    for (let i = 0; i < 300 && room.status !== 'ready'; i++) {
      await new Promise((r) => setTimeout(r, 30));
      room = (await inject<WarRoomDTO & { status: string }>('GET', `/warroom/${w.body.warRoomId}`)).body;
    }
    expect(room.plans.every((p) => p.stats)).toBe(true);
    const commit = (await inject<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room.warRoomId, planId: room.recommended })).body;
    const s = createBattle({ engineVersion: ENGINE_VERSION, seed: commit.seed, base: commit.base, army: commit.army, actions: commit.plan.actions });
    while (!s.ended) step(s);
    const bytes = encodeReplay({ engineVersion: ENGINE_VERSION, seed: commit.seed, base: commit.base, army: commit.army, actions: s.applied });
    const sub = await inject<{ verified: boolean }>('POST', `/battle/${commit.battleId}/submit`, { replay: bytesToBase64(bytes) });
    expect(sub.body.verified).toBe(true);
    const replay = await built.app.inject({ method: 'GET', url: `/battle/${commit.battleId}/replay.rrpl` });
    expect(replay.statusCode).toBe(200);
    expect(replay.rawPayload.subarray(0, 4).toString()).toBe('RRPL');
  });

  it('tampered replay → verified:false', async () => {
    const room = (await inject<WarRoomDTO>('POST', '/warroom', { targetIslandId: 'kragmoor' })).body;
    await new Promise((r) => setTimeout(r, 50));
    const commit = (await inject<BattleCommitDTO>('POST', '/battle/commit', { warRoomId: room.warRoomId, planId: 'shieldwall' })).body;
    const bytes = encodeReplay({ engineVersion: ENGINE_VERSION, seed: commit.seed, base: commit.base, army: commit.army, actions: commit.plan.actions });
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; // flip a bit in the embedded base
    const sub = await inject<{ verified: boolean }>('POST', `/battle/${commit.battleId}/submit`, { replay: bytesToBase64(bytes) });
    expect(sub.body.verified).toBe(false);
  });

  it('night policy is sealed once and a mismatch is rejected', async () => {
    await inject('POST', '/night/policy', {});
    expect((await inject('POST', '/night/policy/confirm', {})).status).toBe(200);
    expect((await inject('POST', '/night/policy', {})).status).toBe(409);
    const sim = await inject<{ reportId: string }>('POST', '/night/simulate');
    expect(sim.status).toBe(200);
    const rep = await inject<{ report: { attacks: unknown[] } }>('GET', '/night/report');
    expect(rep.body.report.attacks.length).toBeGreaterThan(0);
  });

  it('agents answer with the field manual when offline', async () => {
    const r = await inject<{ output: { greeting: string }; fallback: boolean }>('POST', '/agents/general/briefing', {});
    expect(r.status).toBe(200);
    expect(r.body.fallback).toBe(true);
    expect(r.body.output.greeting.length).toBeGreaterThan(5);
  });


  it('public profile and agent card', async () => {
    const home = (await inject<HomeDTO>('GET', '/home')).body;
    const p = await inject<{ general: { name: string } }>('GET', `/profile/${home.player.id}`, undefined, {});
    expect(p.body.general.name).toBe('Ysolt');
    const card = await inject<{ type: string; realmRaiders: { appearanceHash: string } }>('GET', `/agents/${home.player.id}/card.json`, undefined, {});
    expect(card.body.type).toContain('eip-8004');
    expect(card.body.realmRaiders.appearanceHash).toMatch(/^0x/);
  });
});

describe('CORS for the Capacitor app', () => {
  it('preflight allows PUT from https://localhost', async () => {
    const res = await built.app.inject({
      method: 'OPTIONS',
      url: '/general',
      headers: { origin: 'https://localhost', 'access-control-request-method': 'PUT', 'access-control-request-headers': 'authorization,content-type' },
    });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['access-control-allow-methods'])).toContain('PUT');
  });
});

describe('Auto Mode and Gems over HTTP (SQLite tables gem_log + auto_sessions)', () => {
  it('seals Auto Orders, pauses manual play with 423, stops on TAKE CONTROL, and keeps the Gems ledger', async () => {
    const before = (await inject<{ balance: number; history: { label: string; delta: number }[] }>('GET', '/gems')).body;
    const prep = await inject<{ nightId: number; policyHash: string }>('POST', '/auto/prepare', {
      minutes: 30,
      orders: { raidsPerHour: 0, minWinPct: 70, reserveGoldPct: 30, upgradeFirst: 'defences', strikeBack: true, shieldAtPct: 60 },
    });
    expect(prep.status).toBe(200);
    expect(prep.body.nightId).toBeGreaterThanOrEqual(3_000_000_000);
    const started = await inject<{ status: string; ordersHash: string }>('POST', '/auto/confirm', {});
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('running');
    const home = await inject<HomeDTO>('GET', '/home');
    expect(home.body.auto?.status).toBe('running');
    const blocked = await inject<{ error: string }>('POST', '/base/upgrade', { buildingId: home.body.base.layout.buildings[0]!.id });
    expect(blocked.status).toBe(423);
    expect(blocked.body.error).toBe('Auto Mode is running — tap Take Control to play yourself.');
    const stopped = await inject<{ session: { status: string } }>('POST', '/auto/stop', {});
    expect(stopped.body.session.status).toBe('stopped');
    expect((await inject('POST', '/base/seal/prepare', {})).status).toBe(200);
    const after = (await inject<{ balance: number; history: { label: string; delta: number }[] }>('GET', '/gems')).body;
    expect(after.history.find((g) => g.label === 'Auto Mode 30 min')).toMatchObject({ delta: -2 });
    expect(after.balance).toBeLessThanOrEqual(before.balance - 2 + 40);
  }, 60_000);
});
