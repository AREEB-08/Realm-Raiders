import { simulate } from '@realm/battle-engine';
import type { AgentRequest, AgentResult, AgentRunner, Ctx } from './ctx';
import { InlineSims } from './ctx';
import { matchRoute } from './routes';
import { ensureWorld } from './services/common';
import { AutoRunner } from './services/auto';
import { LanHub } from './services/lan';
import { HttpError } from './types';

/** Offline officers: always the field manual (the UI labels it). */
export class FallbackAgents implements AgentRunner {
  async run<T>(req: AgentRequest<T>): Promise<AgentResult<T>> {
    const t0 = Date.now();
    return { output: req.fallback(), fallback: true, latencyMs: Date.now() - t0 };
  }
}

export const inlineSims = () =>
  new InlineSims((input) => {
    const r = simulate(input);
    return { stars: r.stars, destructionBp: r.destructionBp, ticks: r.ticks };
  });

export interface Core {
  ctx: Ctx;
  auto: AutoRunner;
  lan: LanHub;
  start(): Promise<void>;
  stop(): void;
  /** Dispatch a request the way the HTTP server would (offline app mode, tests). */
  handle(method: string, path: string, body: unknown, playerId: string | null): Promise<unknown>;
}

export function createCore(ctx: Ctx): Core {
  const auto = new AutoRunner(ctx);
  const lan = new LanHub(ctx);
  return {
    ctx,
    auto,
    lan,
    async start() {
      await ensureWorld(ctx);
      // Auto Mode sessions: run (or, after a resume, catch up on) every beat that is due.
      auto.start();
      lan.start();
    },
    stop() {
      auto.stop();
      lan.stop();
    },
    async handle(method, path, body, playerId) {
      const found = matchRoute(method.toUpperCase(), path);
      if (!found) throw new HttpError(404, `no route ${method} ${path}`);
      const { def, params } = found;
      if (def.auth && !playerId) throw new HttpError(401, 'sign in first');
      let parsed = body;
      if (def.body) {
        const r = def.body.safeParse(body ?? {});
        if (!r.success) throw new HttpError(400, 'invalid request', r.error.issues);
        parsed = r.data;
      }
      return def.handler(ctx, { playerId: playerId ?? '', body: parsed, params });
    },
  };
}
