/// <reference lib="webworker" />
import { simulate, verifyReplay, type BattleInput, type VerifyExpect } from '@realm/battle-engine';

type Job = { id: number; inputs: BattleInput[] } | { id: number; verify: { bytes: Uint8Array; expect: VerifyExpect } };

/**
 * Practice raids off the main thread (War Room, local mode), the /dev/sim digest, and replay
 * verification for the Profile (a full re-simulation would freeze the UI thread on a phone).
 */
self.onmessage = (e: MessageEvent<Job>) => {
  const job = e.data;
  try {
    if ('verify' in job) {
      const r = verifyReplay(job.verify.bytes, job.verify.expect);
      (self as unknown as Worker).postMessage({ id: job.id, ok: true, verify: { ok: r.ok, reasons: r.reasons, replayHash: r.replayHash } });
      return;
    }
    const results = job.inputs.map((input) => {
      const r = simulate(input);
      return { stars: r.stars, destructionBp: r.destructionBp, ticks: r.ticks, stateHash: r.stateHash };
    });
    (self as unknown as Worker).postMessage({ id: job.id, ok: true, results });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: job.id, ok: false, error: (err as Error).message });
  }
};
