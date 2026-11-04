import { BADGES } from '@realm/game-data';
import { Bodies, type Hex } from '@realm/shared';
import type { z } from 'zod';
import type { Ctx } from './ctx';
import { applyPatch, architectReview, build, buildWalls, hurry, putLayout, sealConfirm, sealPrepare, sealRelay, upgrade } from './services/base';
import { commentary, commitBattle, getBattle, getReplay, submitBattle } from './services/battle';
import { agentCard, agentUri, confirmAgent, greetingTask, putGeneral, putPortrait, relayAgent } from './services/general';
import { collectBuilding, demoLogin, generalBriefingTask, getHome } from './services/home';
import { confirmPolicy, draftPolicy, getPolicy, getReport, preparePolicy, simulateNight } from './services/night';
import { getProfile, profileLine } from './services/profile';
import { assertManual, confirmAuto, draftAutoOrders, getAuto, prepareAuto, stopAuto } from './services/auto';
import { gemHistory } from './services/gems';
import { loadPlayer } from './services/common';
import { NO_HOST, lanOf } from './services/lan';

const hub = (ctx: Ctx) => {
  const h = lanOf(ctx);
  if (!h) throw new HttpError(409, NO_HOST);
  return h;
};

/** Public room info for the /24 scan ("Host found: Ayaan's laptop (192.168.1.12)"); never the code. */
function lanInfo(ctx: Ctx) {
  const lan = ctx.cfg.lan;
  return lan ? { lan: true, hostName: lan.hostName, players: lanOf(ctx)?.memberIds().length ?? 0 } : { lan: false, hostName: null, players: 0 };
}
import { listTargets } from './services/targets';
import { coachPlan, createWarRoom, getWarRoom } from './services/warroom';
import { HttpError } from './types';

export interface RouteReq {
  playerId: string;
  body: any;
  params: Record<string, string>;
}

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  auth: boolean;
  body?: z.ZodType;
  handler: (ctx: Ctx, req: RouteReq) => Promise<unknown>;
}

const r = (def: RouteDef) => def;

/** Manual play: refused while Auto Mode runs ("tap Take Control to play yourself"). */
const manual =
  (h: (ctx: Ctx, q: RouteReq) => Promise<unknown>) =>
  async (ctx: Ctx, q: RouteReq) => {
    await assertManual(ctx, q.playerId);
    return h(ctx, q);
  };

/** The REST surface of §16.3, shared by the Fastify server and the in-app offline server. */
export const ROUTES: RouteDef[] = [
  r({ method: 'POST', path: '/auth/demo', auth: false, body: Bodies.demoAuth, handler: (ctx, q) => demoLogin(ctx, q.body.deviceId) }),
  r({ method: 'GET', path: '/home', auth: true, handler: (ctx, q) => getHome(ctx, q.playerId) }),
  r({ method: 'POST', path: '/home/collect', auth: true, body: Bodies.collect, handler: manual((ctx, q) => collectBuilding(ctx, q.playerId, q.body.buildingId) ) }),

  r({ method: 'PUT', path: '/general', auth: true, body: Bodies.putGeneral, handler: (ctx, q) => putGeneral(ctx, q.playerId, q.body) }),
  r({ method: 'POST', path: '/general/portrait', auth: true, body: Bodies.portrait, handler: (ctx, q) => putPortrait(ctx, q.playerId, q.body.png) }),
  r({ method: 'POST', path: '/chain/agent/card', auth: true, handler: (ctx, q) => agentUri(ctx, q.playerId) }),
  r({ method: 'POST', path: '/chain/agent/confirm', auth: true, body: Bodies.txConfirm, handler: (ctx, q) => confirmAgent(ctx, q.playerId, q.body.txHash as Hex) }),
  r({ method: 'POST', path: '/chain/agent/relay', auth: true, handler: (ctx, q) => relayAgent(ctx, q.playerId) }),
  r({ method: 'GET', path: '/agents/:playerId/card.json', auth: false, handler: (ctx, q) => agentCard(ctx, q.params.playerId!) }),

  r({ method: 'PUT', path: '/base/layout', auth: true, body: Bodies.putLayout, handler: manual((ctx, q) => putLayout(ctx, q.playerId, q.body.layout) ) }),
  r({ method: 'POST', path: '/base/build', auth: true, body: Bodies.build, handler: manual((ctx, q) => build(ctx, q.playerId, q.body.type, q.body.x, q.body.y) ) }),
  r({ method: 'POST', path: '/base/walls', auth: true, body: Bodies.buildWalls, handler: manual((ctx, q) => buildWalls(ctx, q.playerId, q.body.tiles) ) }),
  r({ method: 'POST', path: '/base/upgrade', auth: true, body: Bodies.upgrade, handler: manual((ctx, q) => upgrade(ctx, q.playerId, q.body.buildingId) ) }),
  r({ method: 'POST', path: '/base/hurry', auth: true, body: Bodies.hurry, handler: manual((ctx, q) => hurry(ctx, q.playerId, q.body.buildingId) ) }),
  r({ method: 'POST', path: '/base/seal/prepare', auth: true, handler: (ctx, q) => sealPrepare(ctx, q.playerId) }),
  r({ method: 'POST', path: '/base/seal/confirm', auth: true, body: Bodies.txConfirm, handler: manual((ctx, q) => sealConfirm(ctx, q.playerId, q.body.txHash as Hex) ) }),
  r({ method: 'POST', path: '/base/seal/relay', auth: true, body: Bodies.sealRelay, handler: manual((ctx, q) => sealRelay(ctx, q.playerId, q.body) ) }),
  r({ method: 'POST', path: '/base/patch/apply', auth: true, body: Bodies.applyPatch, handler: manual((ctx, q) => applyPatch(ctx, q.playerId) ) }),

  r({ method: 'GET', path: '/targets', auth: true, handler: async (ctx, q) => ({ islands: await listTargets(ctx, q.playerId) }) }),
  r({ method: 'POST', path: '/warroom', auth: true, body: Bodies.warroom, handler: manual((ctx, q) => createWarRoom(ctx, q.playerId, q.body.targetIslandId) ) }),
  r({ method: 'GET', path: '/warroom/:id', auth: true, handler: (ctx, q) => getWarRoom(ctx, q.playerId, q.params.id!) }),
  r({ method: 'POST', path: '/warroom/:id/coach', auth: true, body: Bodies.coach, handler: manual((ctx, q) => coachPlan(ctx, q.playerId, q.params.id!, q.body.planId, q.body.note) ) }),

  r({ method: 'POST', path: '/battle/commit', auth: true, body: Bodies.commit, handler: manual((ctx, q) => commitBattle(ctx, q.playerId, q.body.warRoomId, q.body.planId, q.body.attackerNonce, q.body.duelId)) }),
  r({ method: 'POST', path: '/battle/:id/submit', auth: true, body: Bodies.submit, handler: manual((ctx, q) => submitBattle(ctx, q.playerId, q.params.id!, q.body.replay) ) }),
  r({ method: 'GET', path: '/battle/:id', auth: false, handler: (ctx, q) => getBattle(ctx, q.params.id!) }),
  r({ method: 'GET', path: '/battle/:id/replay', auth: false, handler: (ctx, q) => getReplay(ctx, q.params.id!) }),

  r({ method: 'GET', path: '/night/policy', auth: true, handler: async (ctx, q) => ({ policy: await getPolicy(ctx, q.playerId) }) }),
  r({ method: 'POST', path: '/night/policy', auth: true, body: Bodies.policy, handler: manual((ctx, q) => preparePolicy(ctx, q.playerId, q.body.policy ?? {}) ) }),
  r({ method: 'POST', path: '/night/policy/confirm', auth: true, body: Bodies.policyConfirm, handler: manual((ctx, q) => confirmPolicy(ctx, q.playerId, q.body) ) }),
  r({ method: 'POST', path: '/night/simulate', auth: true, handler: manual((ctx, q) => simulateNight(ctx, q.playerId) ) }),
  r({ method: 'GET', path: '/night/report', auth: true, handler: async (ctx, q) => ({ report: await getReport(ctx, q.playerId) }) }),

  r({ method: 'GET', path: '/auto', auth: true, handler: (ctx, q) => getAuto(ctx, q.playerId) }),
  r({ method: 'POST', path: '/auto/prepare', auth: true, body: Bodies.autoPrepare, handler: (ctx, q) => prepareAuto(ctx, q.playerId, q.body.minutes, q.body.orders) }),
  r({ method: 'POST', path: '/auto/confirm', auth: true, body: Bodies.autoConfirm, handler: (ctx, q) => confirmAuto(ctx, q.playerId, q.body) }),
  r({ method: 'POST', path: '/auto/stop', auth: true, handler: async (ctx, q) => ({ session: await stopAuto(ctx, q.playerId) }) }),
  r({
    method: 'GET',
    path: '/gems',
    auth: true,
    handler: async (ctx, q) => gemHistory(ctx, q.playerId, (await loadPlayer(ctx, q.playerId)).res),
  }),

  // Play with Friends (spec F9). Offline (no host) every call answers "needs a host on your Wi-Fi".
  r({ method: 'GET', path: '/lan/info', auth: false, handler: async (ctx) => lanInfo(ctx) }),
  r({ method: 'POST', path: '/lan/join', auth: true, body: Bodies.lanJoin, handler: (ctx, q) => hub(ctx).join(q.playerId, q.body.code) }),
  r({ method: 'GET', path: '/lan/lobby', auth: true, handler: (ctx, q) => hub(ctx).lobby(q.playerId) }),
  r({ method: 'POST', path: '/lan/ready', auth: true, body: Bodies.lanStatus, handler: (ctx, q) => hub(ctx).setReady(q.playerId, !!q.body.ready) }),
  r({ method: 'POST', path: '/lan/emote', auth: true, body: Bodies.lanEmote, handler: async (ctx, q) => hub(ctx).emote(q.playerId, q.body.emote) }),
  r({ method: 'POST', path: '/lan/leave', auth: true, handler: async (ctx, q) => (await hub(ctx).leave(q.playerId), { ok: true }) }),
  r({ method: 'GET', path: '/battle/:id/spectate', auth: true, handler: (ctx, q) => hub(ctx).spectate(q.playerId, q.params.id!) }),
  r({ method: 'POST', path: '/duel/invite', auth: true, body: Bodies.duelInvite, handler: manual((ctx, q) => hub(ctx).invite(q.playerId, q.body.to)) }),
  r({ method: 'GET', path: '/duel/:id', auth: true, handler: async (ctx, q) => hub(ctx).dto(await hub(ctx).duel(q.params.id!)) }),
  r({ method: 'POST', path: '/duel/:id/accept', auth: true, handler: manual((ctx, q) => hub(ctx).accept(q.playerId, q.params.id!)) }),
  r({ method: 'POST', path: '/duel/:id/decline', auth: true, handler: (ctx, q) => hub(ctx).decline(q.playerId, q.params.id!) }),


  r({ method: 'GET', path: '/profile/:playerId', auth: false, handler: (ctx, q) => getProfile(ctx, q.params.playerId!) }),
  r({
    method: 'GET',
    path: '/badges/:id',
    auth: false,
    handler: async (ctx, q) => {
      const id = Number(String(q.params.id).replace('.json', ''));
      const b = BADGES.find((x) => x.id === id);
      if (!b) throw new HttpError(404, 'no such badge');
      return { name: b.name, description: b.desc, image: `${ctx.cfg.publicBaseUrl}/badges/${id}.svg`, properties: { soulbound: true, game: 'Realm Raiders' } };
    },
  }),

  r({ method: 'POST', path: '/agents/:role/:task', auth: true, body: Bodies.agentTask, handler: (ctx, q) => agentTask(ctx, q) }),
];

async function agentTask(ctx: Ctx, q: RouteReq) {
  const key = `${q.params.role}/${q.params.task}`;
  switch (key) {
    case 'general/briefing':
      return generalBriefingTask(ctx, q.playerId);
    case 'general/greeting':
      return greetingTask(ctx, q.playerId);
    case 'general/profile':
      return profileLine(ctx, q.playerId);
    case 'architect/tips': {
      const review = await architectReview(ctx, q.playerId, q.body?.layout);
      return { output: review, fallback: review.agent.fallback, latencyMs: review.agent.latencyMs };
    }
    case 'architect/review': {
      const report = await getReport(ctx, q.playerId, q.body?.reportId);
      if (!report) throw new HttpError(404, 'no report');
      return { output: report.architect, fallback: report.architect.agent.fallback, latencyMs: report.architect.agent.latencyMs };
    }
    case 'night/draft':
    case 'night_captain/draft':
      return draftPolicy(ctx, q.playerId);
    case 'night_captain/auto':
      return draftAutoOrders(ctx, q.playerId);
    case 'strategist/commentary':
      return commentary(ctx, q.playerId, {
        tick: Number(q.body?.tick ?? 0),
        destructionPct: Number(q.body?.destructionPct ?? 0),
        stars: Number(q.body?.stars ?? 0),
        alive: Number(q.body?.alive ?? 0),
        lastEvent: typeof q.body?.lastEvent === 'string' ? q.body.lastEvent.slice(0, 120) : undefined,
      });
    case 'intel/report': {
      const b = await getBattle(ctx, String(q.body?.battleId ?? ''));
      return { output: b.report, fallback: true, latencyMs: 0 };
    }
    default:
      throw new HttpError(404, `unknown agent task ${key}`);
  }
}

/** Match a path against the table (used by the in-app offline server). */
export function matchRoute(method: string, path: string) {
  const clean = path.split('?')[0]!.replace(/\/+$/, '') || '/';
  for (const def of ROUTES) {
    if (def.method !== method) continue;
    const names: string[] = [];
    const re = new RegExp(
      '^' +
        def.path.replace(/[.]/g, '\\.').replace(/:(\w+)/g, (_m, n: string) => {
          names.push(n);
          return '([^/]+)';
        }) +
        '$',
    );
    const m = re.exec(clean);
    if (!m) continue;
    const params: Record<string, string> = {};
    names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1]!)));
    return { def, params };
  }
  return null;
}
