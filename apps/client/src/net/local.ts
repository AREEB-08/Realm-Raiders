import { verifyReplay, type BattleInput, type VerifyExpect } from '@realm/battle-engine';
import {
  FallbackAgents,
  MemoryBus,
  MemoryRepo,
  MockChain,
  createCore,
  inlineSims,
  type Core,
  type MockChainState,
  type RepoSnapshot,
  type SimRunner,
  type SimSummary,
} from '@realm/core';
import { loadWorld, saveWorld } from '../persist/save';

/** Web Worker pool for practice raids; falls back to the main thread if workers are unavailable. */
export class WorkerSims implements SimRunner {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private waiting: (() => void)[] = [];
  private seq = 0;
  private inline = inlineSims();

  constructor(size = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 2) - 1))) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./simWorker.ts', import.meta.url), { type: 'module' });
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch {
      this.workers = [];
    }
  }

  private async take(): Promise<Worker> {
    while (!this.idle.length) await new Promise<void>((r) => this.waiting.push(r));
    return this.idle.pop()!;
  }

  private give(w: Worker) {
    this.idle.push(w);
    this.waiting.shift()?.();
  }

  private async send<T>(job: Record<string, unknown>, pick: (data: any) => T): Promise<T> {
    const w = await this.take();
    try {
      return await new Promise<T>((resolve, reject) => {
        const id = ++this.seq;
        const onMsg = (e: MessageEvent) => {
          if (e.data.id !== id) return;
          w.removeEventListener('message', onMsg);
          if (e.data.ok) resolve(pick(e.data));
          else reject(new Error(e.data.error));
        };
        w.addEventListener('message', onMsg);
        w.postMessage({ id, ...job });
      });
    } finally {
      this.give(w);
    }
  }

  runRaw(inputs: BattleInput[]): Promise<(SimSummary & { stateHash: string })[]> {
    return this.send({ inputs }, (d) => d.results);
  }

  /** Re-simulate a recorded replay off the main thread (Profile → VERIFY). */
  async verify(bytes: Uint8Array, expect: VerifyExpect): Promise<{ ok: boolean; reasons: string[] }> {
    if (!this.workers.length) {
      const r = verifyReplay(bytes, expect);
      return { ok: r.ok, reasons: r.reasons };
    }
    return this.send({ verify: { bytes, expect } }, (d) => d.verify);
  }

  async run(inputs: BattleInput[], onProgress?: (done: number) => void): Promise<SimSummary[]> {
    if (!this.workers.length) return this.inline.run(inputs, onProgress);
    const parts: BattleInput[][] = [];
    for (let i = 0; i < inputs.length; i += 5) parts.push(inputs.slice(i, i + 5));
    let done = 0;
    try {
      const out = await Promise.all(
        parts.map((p) =>
          this.runRaw(p).then((r) => {
            done += r.length;
            onProgress?.(done);
            return r;
          }),
        ),
      );
      return out.flat();
    } catch {
      return this.inline.run(inputs, onProgress);
    }
  }
}

let core: Core | null = null;
let sims: WorkerSims | null = null;

export function workerSims() {
  return (sims ??= new WorkerSims());
}

/**
 * The whole game server, in the app (offline mode): the same core services and route table as
 * apps/server, on an in-memory repo saved to IndexedDB, with the mock chain and the officers'
 * field manual. Every screen works without a network (§11 "Offline mode").
 */
export async function startLocal(): Promise<Core> {
  if (core) return core;
  const saved = (await loadWorld()).data as { repo?: RepoSnapshot; chain?: MockChainState } | null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  // eslint-disable-next-line prefer-const
  let chain: MockChain;
  const repo = new MemoryRepo(() => persist());
  const persist = () => {
    if (persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      saveWorld({ repo: repo.snapshot(['agentLog', 'agentMemory', 'txs']), chain: chain.snapshot() });
    }, 500);
  };
  if (saved?.repo) repo.restore(saved.repo);
  chain = new MockChain(10143, { state: saved?.chain, latencyMs: 300, save: () => persist() });
  core = createCore({
    repo,
    chain,
    agents: new FallbackAgents(),
    sims: workerSims(),
    bus: new MemoryBus(),
    files: { putPortrait: async (_id, b64) => `data:image/png;base64,${b64}` },
    cfg: { publicBaseUrl: '', allowDemoAuth: true, demo: true },
    now: () => Date.now(),
    log: (m, x) => console.info('[realm:local]', m, x ?? ''),
  });
  await core.start();
  return core;
}

export const localCore = () => core;
