import { SUPPORTED_ENGINE_VERSIONS, stabilityDigest } from '../src';
// One digest per supported rule set (v1 = frozen launch rules, v2 = current); /dev/sim prints the same lines.
for (const v of SUPPORTED_ENGINE_VERSIONS) {
  const t0 = performance.now();
  const { digest } = stabilityDigest(200, v);
  console.log(`node ${process.version}: v${v} 200-seed digest ${digest} (${Math.round(performance.now() - t0)} ms)`);
}
