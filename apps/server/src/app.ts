import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  FallbackAgents,
  HttpError,
  MockChain,
  ROUTES,
  authLogin,
  createCore,
  type Chain,
  type Core,
  type Ctx,
  type MockChainState,
} from '@realm/core';
import { Bodies, channels, deploymentFor } from '@realm/shared';
import { hostname } from 'node:os';
import { LlmAgents, providersFromEnv } from './agents/runner';
import { lanPage } from './lan-page';
import { privyVerifier, sessionIssuer } from './auth';
import { LiveChain } from './chain/live';
import { chainStatus } from './chain/status';
import { openRepo } from './db/repo';
import { readEnv, SERVER_ROOT, type ServerEnv } from './env';
import { SimPool } from './sim/pool';
import { WsHub, parseClientMsg } from './ws/hub';

export interface BuiltApp {
  app: ReturnType<typeof Fastify>;
  core: Core;
  env: ServerEnv;
  close(): Promise<void>;
}

function chainFrom(env: ServerEnv, repo: Ctx['repo'], log: Ctx['log']): Chain {
  const dep = deploymentFor(env.CHAIN_ID);
  const ledger = env.REALM_LEDGER_ADDRESS ?? dep.RealmLedger;
  const badges = env.REALM_BADGES_ADDRESS ?? dep.RealmBadges;
  if (env.CHAIN_MODE === 'live') {
    if (env.RELAYER_PRIVATE_KEY && ledger && badges) {
      return new LiveChain(
        {
          chainId: env.CHAIN_ID,
          rpcUrl: env.RPC_URL,
          rpcFallback: env.RPC_URL_FALLBACK,
          explorerUrl: env.EXPLORER_URL,
          relayerKey: env.RELAYER_PRIVATE_KEY as `0x${string}`,
          ledger: ledger as `0x${string}`,
          badges: badges as `0x${string}`,
          identity: (dep.RealmAgentRegistry ?? env.ERC8004_IDENTITY) as `0x${string}`,
          reputation: env.ERC8004_REPUTATION as `0x${string}`,
          duels: (env.REALM_DUELS_ADDRESS ?? dep.RealmDuels ?? null) as `0x${string}` | null,
        },
        repo,
        log,
      );
    }
    log('CHAIN_MODE=live but the relayer key or contract addresses are missing — using the mock chain');
  }
  return new MockChain(env.CHAIN_ID, { latencyMs: env.DB_FILE === ':memory:' ? 0 : 250 });
}

export async function buildApp(overrides: Record<string, string | undefined> = {}): Promise<BuiltApp> {
  const env = readEnv(overrides);
  const app = Fastify({ logger: env.QUIET ? false : { level: 'info' }, bodyLimit: 1_048_576 });
  const log: Ctx['log'] = (m, x) => (env.QUIET ? undefined : app.log.info(x === undefined ? m : { msg: m, extra: x }));
  const { repo, sqlite } = openRepo(env.DB_FILE);
  let chain = chainFrom(env, repo, log);
  // Mock chain state survives restarts (kv row).
  if (chain instanceof MockChain) {
    const saved = (await repo.kv.get('mockchain'))?.value as MockChainState | undefined;
    chain = new MockChain(env.CHAIN_ID, {
      state: saved,
      latencyMs: env.DB_FILE === ':memory:' ? 0 : 250,
      save: (state) => void repo.kv.put({ id: 'mockchain', value: state }),
    });
  }
  const hub = new WsHub();
  const portraits = join(SERVER_ROOT, 'data', 'portraits');
  const providers = providersFromEnv(env);
  const agents =
    env.AGENTS_MODE === 'live' && providers.length
      ? new LlmAgents({ mode: 'live', providers, timeoutMs: env.LLM_TIMEOUT_MS, ratePerMinute: 30, cacheMs: 600_000 }, repo, log)
      : new FallbackAgents();
  const sims = new SimPool(env.DB_FILE === ':memory:' ? 1 : env.SIM_WORKERS);
  const ctx: Ctx = {
    repo,
    chain,
    agents,
    sims,
    bus: hub,
    files: {
      async putPortrait(playerId, b64) {
        mkdirSync(portraits, { recursive: true });
        writeFileSync(join(portraits, `${playerId}.png`), Buffer.from(b64, 'base64'));
        return `${env.PUBLIC_BASE_URL}/portraits/${playerId}.png?v=${Date.now()}`;
      },
    },
    cfg: {
      publicBaseUrl: env.PUBLIC_BASE_URL,
      allowDemoAuth: env.ALLOW_DEMO_AUTH,
      demo: env.DEMO,
      lan: env.LAN_ROOM ? { room: env.LAN_ROOM.toUpperCase(), hostName: env.LAN_NAME ?? `${hostname()}` } : null,
    },
    now: () => Date.now(),
    log,
  };
  const core = createCore(ctx);
  const sessions = sessionIssuer(env);
  const privy = privyVerifier(env);

  // The app calls from https://localhost (Capacitor) or a dev origin: allow every verb it uses
  // (the plugin's default is GET/HEAD/POST, which silently blocks PUT /general and /base/layout).
  await app.register(cors, { origin: true, methods: ['GET', 'HEAD', 'POST', 'PUT', 'OPTIONS'] });
  await app.register(websocket);

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message, details: err.details });
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) log('request failed', err.message);
    return reply.status(status).send({ error: err.message });
  });

  const playerOf = async (req: FastifyRequest) => {
    const h = req.headers.authorization;
    const token = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
    return token ? sessions.verify(token) : null;
  };

  // --- auth -----------------------------------------------------------------
  app.post('/auth/session', async (req, reply) => {
    const body = Bodies.authSession.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ error: 'invalid request' });
    if (!privy) return reply.status(501).send({ error: 'Privy is not configured on this server (set PRIVY_APP_ID).' });
    const who = await privy.verify(body.data.authToken, body.data.address);
    if (!who) return reply.status(401).send({ error: 'invalid auth token' });
    const r = await authLogin(ctx, who.sub, who.address);
    return { session: await sessions.sign(r.playerId), ...r };
  });
  app.post('/auth/demo', async (req) => {
    const body = Bodies.demoAuth.safeParse(req.body ?? {});
    const r = (await core.handle('POST', '/auth/demo', body.success ? body.data : {}, null)) as { playerId: string; address: string; isNew: boolean };
    return { session: await sessions.sign(r.playerId), ...r };
  });

  // --- the shared route table ----------------------------------------------------
  for (const def of ROUTES) {
    if (def.path === '/auth/demo') continue;
    const url = def.path.replace('/badges/:id', '/badges/:id');
    app.route({
      method: def.method,
      url,
      handler: async (req: FastifyRequest, reply: FastifyReply) => {
        const playerId = await playerOf(req);
        if (def.auth && !playerId) return reply.status(401).send({ error: 'sign in first' });
        let body: unknown = req.body ?? {};
        if (def.body) {
          const parsed = def.body.safeParse(body);
          if (!parsed.success) return reply.status(400).send({ error: 'invalid request', details: parsed.error.issues });
          body = parsed.data;
        }
        return def.handler(ctx, { playerId: playerId ?? '', body, params: req.params as Record<string, string> });
      },
    });
  }

  app.get('/battle/:id/replay.rrpl', async (req, reply) => {
    const r = (await core.handle('GET', `/battle/${(req.params as { id: string }).id}/replay`, undefined, null)) as { replay: string };
    return reply.type('application/octet-stream').send(Buffer.from(r.replay, 'base64'));
  });

  app.get('/portraits/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file.replace(/[^a-zA-Z0-9_.-]/g, '');
    const path = join(portraits, file);
    if (!existsSync(path)) return reply.status(404).send({ error: 'no portrait' });
    return reply.type('image/png').send(readFileSync(path));
  });

  // Play with Friends host page (spec F9): the address, the room code and a QR of this page.
  app.get('/lan', async (req, reply) => {
    const lan = ctx.cfg.lan;
    if (!lan) return reply.status(404).type('text/plain').send('This server is not hosting a LAN room. Start it with `pnpm dev:lan`.');
    return reply.type('text/html').send(await lanPage(lan, `${req.protocol}://${req.headers.host ?? 'localhost:8787'}`));
  });

  // Phones probe /health with a ~1.5 s budget, so a slow RPC must never hold it up.
  const chainNow = chainStatus(async () => ({
    block: await chain.blockNumber(),
    balance: chain instanceof LiveChain ? await chain.relayerBalance().catch(() => null) : null,
  }));
  app.get('/health', async () => {
    const { ok: chainOk, block, balance: relayerBalance } = await chainNow();
    let db = false;
    try {
      sqlite.prepare('select 1').get();
      db = true;
    } catch {
      /* reported */
    }
    return {
      ok: db && chainOk,
      db,
      chain: { mode: chain.mode, ok: chainOk, block },
      // Play with Friends: the phone's Wi-Fi scan lists this host (the room code is never sent).
      lan: ctx.cfg.lan ? { hostName: ctx.cfg.lan.hostName, players: core.lan.memberIds().length } : null,
      llm: { mode: agents instanceof LlmAgents ? 'live' : 'offline', model: agents instanceof LlmAgents ? (providers[0]?.model ?? null) : null },
      relayerBalance,
    };
  });

  // --- WebSocket (§16.4) ---------------------------------------------------------
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const token = (req.query as { token?: string }).token;
    const playerId = token ? await sessions.verify(token) : null;
    if (!playerId) {
      socket.send(JSON.stringify({ t: 'error', d: { message: 'bad session' } }));
      socket.close();
      return;
    }
    hub.attach(socket);
    core.lan.online(playerId);
    socket.send(JSON.stringify({ t: 'hello', d: { playerId } }));
    socket.on('message', async (raw: Buffer) => {
      const msg = parseClientMsg(raw.toString());
      if (!msg) return;
      if (msg.t === 'sub') {
        const ch = String(msg.d?.ch ?? '');
        if (ch.startsWith('chain:') && ch !== channels.chain(playerId)) return;
        if (ch.startsWith('player:') && ch !== channels.player(playerId)) return;
        hub.join(socket, ch);
      } else if (msg.t === 'unsub') hub.leave(socket, String(msg.d?.ch ?? ''));
      else if (msg.t === 'live') core.lan.live(playerId, String(msg.d?.battleId ?? ''), Number(msg.d?.tick ?? 0), Array.isArray(msg.d?.actions) ? msg.d.actions : []);
      else if (msg.t === 'duel') core.lan.progress(playerId, String(msg.d?.duelId ?? ''), Number(msg.d?.stars ?? 0), Number(msg.d?.pct ?? 0));
      else if (msg.t === 'ping') socket.send(JSON.stringify({ t: 'pong', d: {} }));
    });
    socket.on('close', () => {
      hub.detach(socket);
      core.lan.offline(playerId);
    });
  });

  // Relayed chain events → per-player tx chips.
  chain.onEvent((e) => {
    for (const key of ['player', 'attacker', 'defender', 'to']) {
      const addr = e.args[key];
      if (typeof addr !== 'string') continue;
      void repo.players.find((p) => p.address.toLowerCase() === addr.toLowerCase()).then((ps) => {
        for (const p of ps)
          hub.publish(channels.chain(p.id), { t: 'tx', d: { kind: e.name, hash: e.tx, status: 'confirmed', url: chain.ref(e.name, e.tx).url } });
      });
    }
  });

  return {
    app,
    core,
    env,
    async close() {
      core.stop();
      await app.close();
      await sims.close();
      sqlite.close();
    },
  };
}
