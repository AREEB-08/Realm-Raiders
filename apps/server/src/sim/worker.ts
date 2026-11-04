import { parentPort } from 'node:worker_threads';
import { simulate, type BattleInput } from '@realm/battle-engine';

parentPort?.on('message', (msg: { inputs: BattleInput[] }) => {
  try {
    const results = msg.inputs.map((input) => {
      const r = simulate(input);
      return { stars: r.stars, destructionBp: r.destructionBp, ticks: r.ticks };
    });
    parentPort!.postMessage({ ok: true, results });
  } catch (e) {
    parentPort!.postMessage({ ok: false, error: (e as Error).message });
  }
});
