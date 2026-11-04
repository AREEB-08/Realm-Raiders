import type { TroopId } from './ids';

export type Side = 'north' | 'east' | 'south' | 'west';
export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];

export interface PlanWave {
  /** Tick at which the wave starts (20 ticks = 1 s). */
  tick: number;
  troop: TroopId;
  count: number;
  /** Spread along the deploy line, in tiles. */
  spread: number;
  /** Ticks between consecutive deploys of the same wave (a held finger streams troops). */
  every: number;
  /** Offset along the deploy line from the side's centre, in tiles. */
  offset?: number;
}

export interface PlanTemplate {
  id: 'shieldwall' | 'sapper_breach' | 'drake_raid';
  name: string;
  summary: string;
  side: Side;
  waves: PlanWave[];
  /** Tick to trigger the General's Rally (omit for none). */
  rallyTick?: number;
}
export type PlanId = PlanTemplate['id'];

/**
 * The Strategist's three plan templates (§14.2, spec F4 counters), sized for a 30-housing War
 * Camp. Ids are stable (they are in saved War Rooms); names and armies follow the v2 roster.
 * - Sword Rush: cheap and fast, Swordsmen in front and Archers behind; weak to splash.
 * - Giant Breach: Stone Giants tank the towers, Sappers open the walls, Swordsmen pour in,
 *   Ember Mages burn the clusters; slower, costly, best against walled, defended bases.
 * - Dragon Strike: one Fire Dragon over every wall with Archers below; the fastest, needs
 *   Ember, and the Wyrm Ballista punishes it.
 */
export const PLAN_TEMPLATES: readonly PlanTemplate[] = [
  {
    id: 'shieldwall',
    name: 'Sword Rush',
    summary: 'Swordsmen charge the nearest buildings while Archers shoot over the walls behind them.',
    side: 'south',
    waves: [
      { tick: 0, troop: 'shield', count: 16, spread: 6, every: 2 },
      { tick: 10, troop: 'general', count: 1, spread: 0, every: 1 },
      { tick: 50, troop: 'longbow', count: 12, spread: 7, every: 2 },
    ],
    rallyTick: 220,
  },
  {
    id: 'sapper_breach',
    name: 'Giant Breach',
    summary: 'Stone Giants soak the towers, Sappers blow the wall, then Swordsmen and Mages pour through.',
    side: 'east',
    waves: [
      { tick: 0, troop: 'ravager', count: 2, spread: 2, every: 6 },
      { tick: 50, troop: 'general', count: 1, spread: 0, every: 1 },
      { tick: 60, troop: 'shield', count: 8, spread: 4, every: 2 },
      { tick: 150, troop: 'sapper', count: 4, spread: 2, every: 5 },
      { tick: 170, troop: 'mage', count: 2, spread: 3, every: 6 },
    ],
    rallyTick: 300,
  },
  {
    id: 'drake_raid',
    name: 'Dragon Strike',
    summary: 'A Fire Dragon flies the walls and burns the core; Archers and a Mage clean up the edge.',
    side: 'west',
    waves: [
      { tick: 0, troop: 'drake', count: 1, spread: 0, every: 1 },
      { tick: 20, troop: 'general', count: 1, spread: 0, every: 1 },
      { tick: 50, troop: 'longbow', count: 6, spread: 6, every: 3 },
      { tick: 80, troop: 'mage', count: 1, spread: 0, every: 1 },
    ],
    rallyTick: 200,
  },
];

/** The housing the templates are sized for (expandPlan scales to the real War Camp). */
export const PLAN_HOUSING = 30;

export const planTemplate = (id: string) => PLAN_TEMPLATES.find((p) => p.id === id);

/** Allowed coaching adjustments (the Strategist maps free text onto these, §14.4). */
export interface Coaching {
  side?: Side;
  /** Extra delay for every wave after the first, in ticks (0–200). */
  waveDelayTicks?: number;
  /** Swap up to 4 housing from one troop type to another. */
  swap?: { from: TroopId; to: TroopId; housing: number };
}

export const COACHING_CHIPS = ['Hit from the east', 'Wait for walls', 'More dragons', 'More mages'] as const;
