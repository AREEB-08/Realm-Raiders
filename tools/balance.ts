/**
 * Balance table for the War Room (spec F4): every plan template against every rival island,
 * 50 seeded practice battles each, on the current engine — the same numbers Sefa shows.
 *   pnpm tsx tools/balance.ts [--sims 50] [--capacity 30]
 */
import { normalizeBase, simulate } from '@realm/battle-engine';
import { NPC_ISLANDS, PLAN_TEMPLATES } from '@realm/game-data';
import { aggregate, armyCost, armyHousing, expandPlan, practiceInputs } from '@realm/core';

const arg = (k: string, d: number) => (process.argv.includes(k) ? Number(process.argv[process.argv.indexOf(k) + 1]) : d);
const sims = arg('--sims', 50);
const capacity = arg('--capacity', 30);

const rows: string[][] = [['island', 'plan', 'win %', 'avg ★', 'razed %', 'p10–p90', 'time s', 'cost', 'housing']];
const startedAt = performance.now();
for (const island of NPC_ISLANDS) {
  const base = normalizeBase(island.layout());
  for (const t of PLAN_TEMPLATES) {
    const plan = expandPlan(t, {}, base, { capacity, troopLevel: 1, generalLevel: 1 });
    const inputs = practiceInputs(base, plan.army, plan.actions, t.id, sims);
    const stats = aggregate(inputs.map((i) => simulate(i)));
    const cost = armyCost(plan.army);
    rows.push([
      island.name,
      t.name,
      String(stats.winRate),
      stats.avgStars.toFixed(2),
      String(stats.avgDestruction),
      `${stats.p10}–${stats.p90}`,
      String(stats.avgSeconds),
      `${cost.timber}T${cost.ember ? ` ${cost.ember}E` : ''}`,
      String(armyHousing(plan.army)),
    ]);
  }
}
const w = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
console.log(`${(rows.length - 1) * sims} battles in ${((performance.now() - startedAt) / 1000).toFixed(1)} s (capacity ${capacity}, engine v2)`);
for (const r of rows) console.log(r.map((v, c) => v.padEnd(w[c]!)).join('  '));
