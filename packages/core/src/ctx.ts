import type { BattleInput } from '@realm/battle-engine';
import type { AgentRole, ServerMsg } from '@realm/shared';
import type { z } from 'zod';
import type { Chain } from './chain/types';
import type { Repo } from './repo';

export interface CoreConfig {
  /** Public origin used in agent cards, badge URIs and replay links ('' in offline app mode). */
  publicBaseUrl: string;
  allowDemoAuth: boolean;
  demo: boolean;
  /** Play with Friends (spec F9): set when this server hosts a LAN room. */
  lan?: { room: string; hostName: string } | null;
}

export interface SimSummary {
  stars: number;
  destructionBp: number;
  ticks: number;
}

/** Runs batches of practice battles (server: worker threads; app: a Web Worker or inline). */
export interface SimRunner {
  run(inputs: BattleInput[], onProgress?: (done: number) => void): Promise<SimSummary[]>;
}

export type ToolHandlers = Partial<Record<string, (args: unknown) => Promise<unknown> | unknown>>;

export interface AgentRequest<T> {
  role: AgentRole;
  task: string;
  playerId: string;
  /** Grounding facts the model may quote (and nothing else). */
  facts: Record<string, unknown>;
  /** Free text the player wrote (wrapped and capped before it reaches a prompt). */
  playerText?: string;
  schema: z.ZodType<T>;
  /** Deterministic rule-based answer, used offline, on timeout and on invalid output. */
  fallback: () => T;
  tools?: ToolHandlers;
  /** Extra validation after the schema (game rules); return an error to reject the output. */
  check?: (out: T) => string | null;
}

export interface AgentResult<T> {
  output: T;
  fallback: boolean;
  latencyMs: number;
}

export interface AgentRunner {
  run<T>(req: AgentRequest<T>): Promise<AgentResult<T>>;
}

/** Tiny pub/sub for WS channels (server: the WS hub; app: in-process listeners). */
export interface Bus {
  publish(channel: string, msg: ServerMsg | { t: string; d: unknown }): void;
  subscribe(channel: string, cb: (msg: ServerMsg | { t: string; d: unknown }) => void): () => void;
}

export interface Files {
  /** Store a PNG (base64) and return the URL (or data URL) to show it. */
  putPortrait(playerId: string, pngBase64: string): Promise<string>;
}

export interface Ctx {
  repo: Repo;
  chain: Chain;
  agents: AgentRunner;
  sims: SimRunner;
  bus: Bus;
  files: Files;
  cfg: CoreConfig;
  now: () => number;
  log: (msg: string, extra?: unknown) => void;
}

export class MemoryBus implements Bus {
  private subs = new Map<string, Set<(msg: never) => void>>();
  publish(channel: string, msg: unknown) {
    for (const cb of this.subs.get(channel) ?? []) (cb as (m: unknown) => void)(msg);
  }
  subscribe(channel: string, cb: (msg: never) => void) {
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }
}

/** Runs sims on the current thread, yielding between batches so timers and I/O keep flowing. */
export class InlineSims implements SimRunner {
  constructor(private readonly simulate: (input: BattleInput) => SimSummary) {}
  async run(inputs: BattleInput[], onProgress?: (done: number) => void) {
    const out: SimSummary[] = [];
    for (let i = 0; i < inputs.length; i++) {
      out.push(this.simulate(inputs[i]!));
      if (i % 5 === 4) {
        onProgress?.(i + 1);
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    onProgress?.(inputs.length);
    return out;
  }
}
