import { useEffect, useState } from 'react';
import { base64ToBytes, replayHash, stabilityDigest, verifyReplay, ENGINE_VERSION, SUPPORTED_ENGINE_VERSIONS } from '@realm/battle-engine';
import { GOLDEN_REPLAYS } from '../../../../packages/battle-engine/fixtures/golden';
import witness from '../../../../packages/battle-engine/fixtures/witness.json';

/**
 * Hidden route `#/dev/sim` (§19 Phase 1): runs the 200-seed digest of every supported engine
 * version and the golden replays inside this WebView. Each digest must equal Node's
 * (`pnpm --filter @realm/battle-engine digest`).
 */
export function DevSim() {
  const [out, setOut] = useState<string[]>(['running…']);
  useEffect(() => {
    setTimeout(() => {
      const lines: string[] = [`engine v${ENGINE_VERSION} (also re-simulates v1) · ${navigator.userAgent}`];
      // One digest per supported rule set: v1 = frozen launch rules, v2 = current roster.
      for (const v of SUPPORTED_ENGINE_VERSIONS) {
        const t0 = performance.now();
        const { digest } = stabilityDigest(200, v);
        lines.push(`v${v} 200-seed digest ${digest} (${Math.round(performance.now() - t0)} ms)`);
      }
      for (const [name, b64] of Object.entries(GOLDEN_REPLAYS)) {
        const bytes = base64ToBytes(b64);
        const w = (witness as unknown as Record<string, { replayHash: string; stars: number; destructionBp: number; finalStateHash: string }>)[name]!;
        const r = verifyReplay(bytes, { stars: w.stars, destructionBp: w.destructionBp, replayHash: w.replayHash as `0x${string}` });
        const same = r.result?.stateHash === w.finalStateHash;
        lines.push(`${name}: ${r.ok && same ? 'OK' : 'MISMATCH'} ${replayHash(bytes)} final ${r.result?.stateHash.slice(0, 18)}…`);
      }
      console.info('[dev/sim]', lines.join('\n'));
      setOut(lines);
    }, 50);
  }, []);
  return (
    <div className="screen">
      <div className="title">/dev/sim</div>
      <pre className="mono" style={{ whiteSpace: 'pre-wrap', userSelect: 'text' }} data-testid="devsim">
        {out.join('\n')}
      </pre>
    </div>
  );
}
