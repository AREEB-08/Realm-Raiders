import { describe, expect, it } from 'vitest';
import {
  BUILDINGS,
  BUILDING_IDS,
  BUILDING_LIMITS,
  NPC_ISLANDS,
  PLAN_TEMPLATES,
  TROOPS,
  TROOP_IDS,
  attackRenown,
  buildCost,
  buildSeconds,
  buildingHp,
  defenceRenown,
  limitFor,
  rankFor,
  scaleOutput,
  starterLayout,
  troopHp,
  troopHitDamage,
  troopTable,
  troopLabel,
  defenceFor,
  PLAN_HOUSING,
  upgradeCost,
  warCampCapacity,
  type Layout,
} from '../src';

function countsOk(layout: Layout) {
  const citadel = layout.buildings.find((b) => b.type === 'citadel')!.level;
  const counts = new Map<string, number>();
  for (const b of layout.buildings) counts.set(b.type, (counts.get(b.type) ?? 0) + 1);
  return [...counts].every(([t, n]) => n <= limitFor(t as never, citadel));
}

describe('game data', () => {
  it('every building id has a complete definition and limits for 5 citadel levels', () => {
    for (const id of BUILDING_IDS) {
      const def = BUILDINGS[id];
      expect(def.id).toBe(id);
      expect(def.size).toBeGreaterThan(0);
      expect(def.hpL1).toBeGreaterThan(0);
      expect(def.maxLevel).toBeGreaterThanOrEqual(1);
      expect(BUILDING_LIMITS[id]).toHaveLength(5);
      if (def.category === 'defence') expect(def.defence).toBeTruthy();
      if (def.category === 'trap') expect(def.trap).toBeTruthy();
    }
  });

  it('every troop id has a complete definition', () => {
    for (const id of TROOP_IDS) {
      const t = TROOPS[id];
      expect(t.id).toBe(id);
      expect(t.hp).toBeGreaterThan(0);
      expect(t.speed).toBeGreaterThan(0);
      expect(t.speed % 20).toBe(0); // whole units per tick
    }
  });

  it('level scaling is integer and monotonic', () => {
    for (const id of BUILDING_IDS) {
      for (let l = 2; l <= BUILDINGS[id].maxLevel; l++) {
        expect(buildingHp(id, l)).toBeGreaterThanOrEqual(buildingHp(id, l - 1));
        expect(Number.isInteger(buildingHp(id, l))).toBe(true);
      }
    }
    expect(buildingHp('citadel', 2)).toBe(3240);
    expect(scaleOutput(16, 2)).toBe(20);
    // v1 (frozen launch roster) keeps its numbers; v2 is the Swordsman of spec F4.
    expect(troopHp('shield', 2, 1)).toBe(312);
    expect(troopHp('shield', 2)).toBe(132);
    expect(troopHitDamage('mage', 1)).toBe(22);
    expect(troopHitDamage('drake', 1)).toBe(140);
  });

  it('cost and time formulas match §10.4', () => {
    expect(upgradeCost(1000, 1)).toBe(1000);
    expect(upgradeCost(1000, 2)).toBe(1600);
    expect(upgradeCost(250, 3)).toBe(640);
    expect(buildCost('wall', 1)).toEqual({ amount: 50, resource: 'gold' });
    expect(buildSeconds(1)).toBe(10);
    expect(buildSeconds(4)).toBe(80);
    for (let l = 2; l <= 5; l++) expect(upgradeCost(150, l)).toBeGreaterThan(upgradeCost(150, l - 1));
  });

  it('renown, ranks and capacity follow §10.5–10.7', () => {
    expect(attackRenown(3, 100, true)).toBe(45);
    expect(attackRenown(1, 57.3, false)).toBe(15);
    expect(defenceRenown(1)).toBe(8);
    expect(defenceRenown(3)).toBe(-12);
    expect(rankFor(0).name).toBe('Squire');
    expect(rankFor(350).name).toBe('Banneret');
    expect(rankFor(5000).next).toBeNull();
    // Raised for the v2 roster (decision Q2): a Fire Dragon (20) fits a level-1 camp with an escort.
    expect(warCampCapacity(1)).toBe(30);
    expect(warCampCapacity(3)).toBe(50);
  });

  it('the starter base and NPC bases respect the citadel count limits', () => {
    expect(countsOk(starterLayout())).toBe(true);
    for (const i of NPC_ISLANDS) expect(countsOk(i.layout())).toBe(true);
  });

  it('plan templates fit a level-1 War Camp (PLAN_HOUSING = 30)', () => {
    expect(PLAN_HOUSING).toBe(warCampCapacity(1));
    for (const p of PLAN_TEMPLATES) {
      const housing = p.waves.reduce((n, w) => n + TROOPS[w.troop].housing * w.count, 0);
      expect(housing).toBeLessThanOrEqual(PLAN_HOUSING);
      expect(p.waves.filter((w) => w.troop === 'general')).toHaveLength(1);
    }
  });
});

describe('engine v2 roster (spec F4)', () => {
  it('matches the spec table (speed = tile-thousandths per tick × 3, per second)', () => {
    const want = {
      shield: { name: 'Swordsman', housing: 1, hp: 110, damage: 12, attackTicks: 20, range: 600, speed: 16 * 3 * 20 },
      longbow: { name: 'Archer', housing: 1, hp: 45, damage: 9, attackTicks: 20, range: 3500, speed: 20 * 3 * 20 },
      ravager: { name: 'Stone Giant', housing: 5, hp: 800, damage: 30, attackTicks: 40, range: 1000, speed: 12 * 3 * 20 },
      mage: { name: 'Ember Mage', housing: 4, hp: 90, damage: 22, attackTicks: 32, range: 3000, speed: 16 * 3 * 20 },
      drake: { name: 'Fire Dragon', housing: 20, hp: 1900, damage: 140, attackTicks: 25, range: 3000, speed: 16 * 3 * 20 },
    } as const;
    for (const [id, w] of Object.entries(want)) expect(TROOPS[id as keyof typeof want]).toMatchObject(w);
    expect(TROOPS.mage).toMatchObject({ volley: 3, splash: 800 });
    expect(TROOPS.drake).toMatchObject({ flies: true, splash: 600 });
    expect(TROOPS.ravager.targets).toBe('defences');
    expect(TROOPS.sapper.targets).toBe('walls');
  });

  it('air rules: Bowyer Tower and Wyrm Ballista hit fliers; Stonethrower, Caltrops and (v2) Obelisk do not', () => {
    expect(defenceFor('bowtower', 2)!.hitsAir).toBe(true);
    expect(defenceFor('ballista', 2)!.hitsAir).toBe(true);
    expect(defenceFor('stonethrower', 2)!.hitsAir).toBe(false);
    expect(defenceFor('obelisk', 2)!.hitsAir).toBe(false);
    expect(defenceFor('obelisk', 1)!.hitsAir).toBe(true); // launch rules frozen
    expect(defenceFor('ballista', 1)!.damage).toBe(55);
    expect(defenceFor('ballista', 2)!.damage).toBe(140);
  });

  it('v1 keeps the launch roster (no Mage), v2 has every id', () => {
    expect(troopTable(1).mage).toBeUndefined();
    expect(troopTable(1).shield!.hp).toBe(260);
    for (const id of TROOP_IDS) expect(troopTable(2)[id]).toBeTruthy();
    expect(troopLabel('shield', 16)).toBe('16 Swordsmen');
    expect(troopLabel('drake', 1)).toBe('1 Fire Dragon');
  });
});
