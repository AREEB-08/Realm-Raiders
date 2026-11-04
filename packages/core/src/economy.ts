import {
  BUILDERS,
  BUILDINGS,
  RESOURCE_IDS,
  STARTING_GEMS,
  citadelCapacity,
  producerCap,
  productionPerSecond,
  storageCapacity,
  warCampCapacity,
  type Layout,
  type ResourceId,
} from '@realm/game-data';
import type { EconomyDTO, ProducerState } from '@realm/shared';
import { citadelLevelOf } from './layout';
import type { BaseDoc, ResourcesDoc } from './types';

export function capacities(layout: Layout): Record<ResourceId, number> {
  const cl = citadelLevelOf(layout);
  const cap = { gold: citadelCapacity('gold', cl), timber: citadelCapacity('timber', cl), ember: citadelCapacity('ember', cl) };
  for (const b of layout.buildings) {
    const s = BUILDINGS[b.type].stores;
    if (s) cap[s.resource] += storageCapacity(b.type, b.level);
  }
  return cap;
}

export function armyCapacity(layout: Layout) {
  const camps = layout.buildings.filter((b) => b.type === 'warcamp');
  return camps.length ? camps.reduce((n, b) => n + warCampCapacity(b.level), 0) : 10;
}

/** Troop level = Muster Hall level (troops max out at 3). */
export function troopLevel(layout: Layout) {
  const hall = layout.buildings.find((b) => b.type === 'musterhall');
  return Math.max(1, Math.min(3, hall?.level ?? 1));
}

/** Finish every upgrade whose timer has run out. Returns the ids that completed. */
export function settleTimers(base: BaseDoc, now: number): string[] {
  const done: string[] = [];
  for (const [id, t] of Object.entries(base.timers)) {
    if (t.readyAt > now) continue;
    const b = base.layout.buildings.find((x) => x.id === id);
    if (b) b.level = t.toLevel;
    delete base.timers[id];
    done.push(id);
  }
  return done;
}

export function producers(base: BaseDoc, now: number): ProducerState[] {
  const out: ProducerState[] = [];
  for (const b of base.layout.buildings) {
    const p = BUILDINGS[b.type].produces;
    if (!p) continue;
    const since = base.collectedAt[b.id] ?? now;
    const perSecond = productionPerSecond(b.type, b.level);
    const cap = producerCap(b.type, b.level);
    out.push({
      buildingId: b.id,
      resource: p.resource,
      perSecond,
      cap,
      pending: Math.min(cap, Math.floor((Math.max(0, now - since) / 1000) * perSecond)),
    });
  }
  return out;
}

/** Move a producer's pending output into the wallet, up to the storage cap. */
export function collect(base: BaseDoc, res: ResourcesDoc, buildingId: string, now: number) {
  const p = producers(base, now).find((x) => x.buildingId === buildingId);
  if (!p) return 0;
  const cap = capacities(base.layout)[p.resource];
  const room = Math.max(0, cap - res[p.resource]);
  const take = Math.min(room, p.pending);
  res[p.resource] += take;
  if (take >= p.pending) base.collectedAt[buildingId] = now;
  else {
    // Keep the uncollected remainder pending.
    const since = base.collectedAt[buildingId] ?? now;
    base.collectedAt[buildingId] = since + Math.floor((take / p.perSecond) * 1000);
  }
  return take;
}

export function economy(base: BaseDoc, res: ResourcesDoc, now: number): EconomyDTO {
  const cap = capacities(base.layout);
  return {
    gold: res.gold,
    timber: res.timber,
    ember: res.ember,
    renown: res.renown,
    cap,
    producers: producers(base, now),
    builders: { total: BUILDERS, busy: Object.keys(base.timers).length },
    armyCapacity: armyCapacity(base.layout),
    troopLevel: troopLevel(base.layout),
    gems: res.gems ?? STARTING_GEMS,
    shieldUntil: res.shieldUntil && res.shieldUntil > now ? res.shieldUntil : 0,
  };
}

export function clampToCaps(res: ResourcesDoc, layout: Layout) {
  const cap = capacities(layout);
  for (const r of RESOURCE_IDS) res[r] = Math.max(0, Math.min(cap[r], Math.floor(res[r])));
}
