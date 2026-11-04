import { availableParallelism } from 'node:os';
import { Worker } from 'node:worker_threads';
import type { BattleInput } from '@realm/battle-engine';
import { inlineSims, type SimRunner, type SimSummary } from '@realm/core';

interface Job {
  inputs: BattleInput[];
  resolve: (r: SimSummary[]) => void;
  reject: (e: Error) => void;
}

/**
 * worker_threads pool for the Strategist's practice raids (§13.7): a batch is split across
 * workers; if workers cannot start (e.g. no TS loader), it falls back to running inline.
 */
export class SimPool implements SimRunner {
  private workers: Worker[] = [];
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private inline = inlineSims();
  private broken = false;

  constructor(size = Math.min(4, Math.max(1, availableParallelism() - 1))) {
    try {
      for (let i = 0; i < size; i++) {
        const w = new Worker(new URL('./worker.ts', import.meta.url), { execArgv: process.execArgv });
        w.on('error', () => (this.broken = true));
        w.unref();
        this.workers.push(w);
        this.idle.push(w);
      }
    } catch {
      this.broken = true;
    }
  }

  private runOn(worker: Worker, inputs: BattleInput[]): Promise<SimSummary[]> {
    return new Promise((resolve, reject) => {
      const onMsg = (msg: { ok: boolean; results?: SimSummary[]; error?: string }) => {
        worker.off('message', onMsg);
        worker.off('error', onErr);
        this.release(worker);
        if (msg.ok) resolve(msg.results!);
        else reject(new Error(msg.error));
      };
      const onErr = (e: Error) => {
        worker.off('message', onMsg);
        this.broken = true;
        reject(e);
      };
      worker.on('message', onMsg);
      worker.once('error', onErr);
      worker.postMessage({ inputs });
    });
  }

  private release(w: Worker) {
    const next = this.queue.shift();
    if (next) this.runOn(w, next.inputs).then(next.resolve, next.reject);
    else this.idle.push(w);
  }

  private exec(inputs: BattleInput[]): Promise<SimSummary[]> {
    const w = this.idle.pop();
    if (w) return this.runOn(w, inputs);
    return new Promise((resolve, reject) => this.queue.push({ inputs, resolve, reject }));
  }

  async run(inputs: BattleInput[], onProgress?: (done: number) => void): Promise<SimSummary[]> {
    if (this.broken || this.workers.length === 0) return this.inline.run(inputs, onProgress);
    const chunk = 5;
    const parts: BattleInput[][] = [];
    for (let i = 0; i < inputs.length; i += chunk) parts.push(inputs.slice(i, i + chunk));
    let done = 0;
    try {
      const results = await Promise.all(
        parts.map((p) =>
          this.exec(p).then((r) => {
            done += r.length;
            onProgress?.(done);
            return r;
          }),
        ),
      );
      return results.flat();
    } catch {
      this.broken = true;
      return this.inline.run(inputs, onProgress);
    }
  }

  async close() {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}
