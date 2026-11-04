import {
  ENGINE_VERSION,
  concatBytes,
  keccak,
  utf8,
  type Action,
  type ArmyComp,
  type BattleInput,
  type SealedBase,
} from '@realm/battle-engine';
import {
  BUILDINGS,
  GRID,
  PLAN_HOUSING,
  PLAN_TEMPLATES,
  TROOPS,
  type Coaching,
  type PlanTemplate,
  type PlanWave,
  type Side,
  type TroopId,
} from '@realm/game-data';
import type { Hex, PlanDTO, PlanStats } from '@realm/shared';
import type { SimSummary } from './ctx';

export const SIMS_PER_PLAN = 50;

/** Deploy-forbidden tiles: every non-trap footprint grown by one tile (same rule as the engine). */
export function noDeployGrid(base: SealedBase): Uint8Array {
  const grid = new Uint8Array(GRID * GRID);
  for (const b of base.buildings) {
    const def = BUILDINGS[b.type];
    if (def.category === 'trap') continue;
    for (let y = b.y - 1; y < b.y + def.size + 1; y++)
      for (let x = b.x - 1; x < b.x + def.size + 1; x++)
        if (x >= 0 && y >= 0 && x < GRID && y < GRID) grid[y * GRID + x] = 1;
  }
  return grid;
}

function baseCentre(base: SealedBase) {
  const c = base.buildings.find((b) => b.type === 'citadel');
  if (!c) return { x: GRID / 2, y: GRID / 2 };
  const s = BUILDINGS.citadel.size;
  return { x: c.x + s / 2, y: c.y + s / 2 };
}

/**
 * The closest deployable point to the base along a line across `side`, at lateral
 * coordinate `along` (tiles). Returns tiles × 10.
 */
export function deployPoint(grid: Uint8Array, base: SealedBase, side: Side, along: number) {
  const c = baseCentre(base);
  const lane = Math.max(0, Math.min(GRID - 1, Math.floor(along)));
  const ok = (x: number, y: number) => grid[y * GRID + x] === 0;
  // Walk from the edge inward while the tiles stay deployable; stop at the last good one.
  if (side === 'south' || side === 'north') {
    const dir = side === 'south' ? -1 : 1;
    let y = side === 'south' ? GRID - 1 : 0;
    const stop = Math.floor(c.y);
    while (y + dir !== stop && ok(lane, y + dir)) y += dir;
    return { x: lane * 10 + 5, y: y * 10 + 5 };
  }
  const dir = side === 'east' ? -1 : 1;
  let x = side === 'east' ? GRID - 1 : 0;
  const stop = Math.floor(c.x);
  while (x + dir !== stop && ok(x + dir, lane)) x += dir;
  return { x: x * 10 + 5, y: lane * 10 + 5 };
}

function applySwap(waves: PlanWave[], swap: NonNullable<Coaching['swap']>): PlanWave[] {
  const out = waves.map((w) => ({ ...w }));
  const from = out.filter((w) => w.troop === swap.from);
  if (!from.length || swap.from === swap.to) return out;
  const toHousing = TROOPS[swap.to].housing;
  const nTo = Math.max(1, Math.floor(swap.housing / toHousing));
  let need = Math.ceil((nTo * toHousing) / TROOPS[swap.from].housing);
  for (const w of from) {
    const take = Math.min(w.count, need);
    w.count -= take;
    need -= take;
    if (need === 0) break;
  }
  if (need > 0) return waves.map((w) => ({ ...w })); // not enough to swap; leave it alone
  const existing = out.find((w) => w.troop === swap.to);
  if (existing) existing.count += nTo;
  else out.push({ tick: from[0]!.tick, troop: swap.to, count: nTo, spread: 3, every: 4 });
  return out.filter((w) => w.count > 0);
}

export interface ExpandOptions {
  capacity: number;
  troopLevel: number;
  generalLevel: number;
}

/** Turn a plan template (+ coaching) into a concrete army and action list against a base. */
export function expandPlan(
  template: PlanTemplate,
  coaching: Coaching,
  base: SealedBase,
  opts: ExpandOptions,
): { army: ArmyComp; actions: Action[]; side: Side } {
  const side = coaching.side ?? template.side;
  let waves = template.waves.map((w) => ({ ...w }));
  if (coaching.swap) waves = applySwap(waves, coaching.swap);
  // Scale to the War Camp (up or down): templates are sized for PLAN_HOUSING (30).
  const scale = opts.capacity / PLAN_HOUSING;
  if (scale !== 1)
    waves = waves
      .map((w) => (w.troop === 'general' ? w : { ...w, count: Math.max(scale < 1 ? 0 : 1, Math.floor(w.count * scale)) }))
      .filter((w) => w.count > 0);
  const delay = coaching.waveDelayTicks ?? 0;
  const grid = noDeployGrid(base);
  const c = baseCentre(base);
  const centreAlong = side === 'north' || side === 'south' ? c.x : c.y;
  const actions: (Action & { seq: number })[] = [];
  let seq = 0;
  waves.forEach((w, wi) => {
    const start = w.tick + (wi > 0 ? delay : 0);
    for (let i = 0; i < w.count; i++) {
      const frac = w.count > 1 ? i / (w.count - 1) - 0.5 : 0;
      const along = centreAlong + (w.offset ?? 0) + frac * w.spread;
      const p = deployPoint(grid, base, side, along);
      actions.push({ t: start + i * w.every, kind: 'deploy', troop: w.troop, x: p.x, y: p.y, seq: seq++ });
    }
  });
  if (template.rallyTick !== undefined) actions.push({ t: template.rallyTick + delay, kind: 'rally', seq: seq++ });
  actions.sort((a, b) => a.t - b.t || a.seq - b.seq);
  const counts = new Map<TroopId, number>();
  for (const w of waves) counts.set(w.troop, (counts.get(w.troop) ?? 0) + w.count);
  const army: ArmyComp = {
    troops: [...counts]
      .filter(([, n]) => n > 0)
      .map(([troop, count]) => ({
        troop,
        count,
        level: troop === 'general' ? opts.generalLevel : Math.min(TROOPS[troop].maxLevel, opts.troopLevel),
      })),
  };
  return { army, actions: actions.map(({ seq: _s, ...a }) => a as Action), side };
}

export function armyCost(army: ArmyComp) {
  let timber = 0;
  let ember = 0;
  for (const e of army.troops) {
    const c = TROOPS[e.troop].cost;
    if (c.resource === 'timber') timber += c.amount * e.count;
    else if (c.resource === 'ember') ember += c.amount * e.count;
  }
  return { timber, ember };
}

export function armyHousing(army: ArmyComp) {
  return army.troops.reduce((n, e) => n + TROOPS[e.troop].housing * e.count, 0);
}

/** Practice seeds: keccak256(planId ‖ u32 i) — never the real battle seed. */
export function practiceSeed(planId: string, i: number): Hex {
  const n = new Uint8Array(4);
  new DataView(n.buffer).setUint32(0, i, false);
  return keccak(concatBytes(utf8(planId), n));
}

/**
 * Practice raids (§14.3). Raid 0 follows the plan exactly; the others add the small slips of a
 * real battle — each deploy up to 6 ticks late and up to 0.3 tiles off along the line (never
 * onto forbidden ground), the Rally ±10 ticks — from a counter seeded by (planId, i). So the
 * win rate is a real estimate, and the same War Room always gives the same numbers.
 */
export function practiceInputs(base: SealedBase, army: ArmyComp, actions: Action[], planId: string, n = SIMS_PER_PLAN): BattleInput[] {
  const grid = noDeployGrid(base);
  return Array.from({ length: n }, (_, i) => ({
    engineVersion: ENGINE_VERSION,
    seed: practiceSeed(planId, i),
    base,
    army,
    actions: i === 0 ? actions : slipActions(actions, grid, planId, i),
  }));
}

function slipActions(actions: Action[], grid: Uint8Array, planId: string, i: number): Action[] {
  let s = 0x2545f491;
  for (let k = 0; k < planId.length; k++) s = Math.imul(s ^ planId.charCodeAt(k), 16777619) >>> 0;
  s = (s ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  const r = (k: number) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) % k;
  };
  const out = actions.map((a, seq) => {
    if (a.kind === 'rally') return { a: { ...a, t: Math.max(0, a.t + r(21) - 10) }, seq };
    if (a.kind !== 'deploy') return { a: { ...a }, seq };
    const t = a.t + r(7);
    const x = a.x + r(7) - 3;
    const y = a.y + r(7) - 3;
    const tx = Math.floor(x / 10);
    const ty = Math.floor(y / 10);
    const ok = tx >= 0 && ty >= 0 && tx < GRID && ty < GRID && grid[ty * GRID + tx] === 0;
    return { a: { ...a, t, x: ok ? x : a.x, y: ok ? y : a.y }, seq };
  });
  out.sort((p, q) => p.a.t - q.a.t || p.seq - q.seq);
  return out.map((o) => o.a);
}

export function aggregate(results: SimSummary[]): PlanStats {
  const n = results.length;
  const pct = results.map((r) => r.destructionBp / 100).sort((a, b) => a - b);
  const q = (p: number) => pct[Math.min(n - 1, Math.max(0, Math.floor(p * (n - 1))))] ?? 0;
  return {
    n,
    winRate: n ? Math.round((results.filter((r) => r.stars >= 1).length / n) * 100) : 0,
    avgStars: n ? Math.round((results.reduce((s, r) => s + r.stars, 0) / n) * 100) / 100 : 0,
    avgDestruction: n ? Math.round(pct.reduce((s, v) => s + v, 0) / n) : 0,
    p10: Math.round(q(0.1)),
    p90: Math.round(q(0.9)),
    avgSeconds: n ? Math.round((results.reduce((s, r) => s + r.ticks, 0) / n / 20) * 10) / 10 : 0,
  };
}

/** Rule-based coaching parser (the Strategist's fallback mapping of free text, §14.4). */
export function parseCoaching(note: string, plan: Pick<PlanDTO, 'army' | 'coaching'>): Coaching {
  const t = note.toLowerCase();
  const out: Coaching = { ...plan.coaching };
  const side = (['north', 'east', 'south', 'west'] as const).find((s) => new RegExp(`\\b${s}`).test(t));
  if (side) out.side = side;
  if (/\bwait|wall|patien|slow|hold/.test(t)) out.waveDelayTicks = Math.min(200, (out.waveDelayTicks ?? 0) + 60);
  if (/fast|rush|quick|now/.test(t)) out.waveDelayTicks = 0;
  const has = (troop: TroopId) => plan.army.troops.some((e) => e.troop === troop && e.count > 0);
  const donor = (avoid: TroopId): TroopId | null =>
    (['longbow', 'shield', 'mage', 'ravager', 'sapper', 'drake'] as TroopId[]).find((d) => d !== avoid && has(d)) ?? null;
  const want: [RegExp, TroopId][] = [
    [/dragon|drake|air|fly|sky/, 'drake'],
    [/mage|fire ?ball|spell|ember/, 'mage'],
    [/giant|tank|soak|brute/, 'ravager'],
    [/sword|charge|rush|infantry/, 'shield'],
    [/archer|longbow|bow|range/, 'longbow'],
    [/sapper|breach|powder|blow/, 'sapper'],
  ];
  for (const [re, troop] of want) {
    if (!re.test(t)) continue;
    const from = donor(troop);
    if (from) out.swap = { from, to: troop, housing: 4 };
    break;
  }
  if (JSON.stringify(out) === JSON.stringify(plan.coaching)) out.waveDelayTicks = (out.waveDelayTicks ?? 0) + 20;
  return out;
}

export const templateById = (id: string) => PLAN_TEMPLATES.find((p) => p.id === id);
