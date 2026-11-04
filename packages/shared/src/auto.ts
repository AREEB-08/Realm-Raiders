import { z } from 'zod';
import { canonicalHash, type Hex } from './canonical';
import type { TxRef } from './api';

/**
 * Auto Orders (spec F8): the only rules the officers may follow while Auto Mode runs. Like night
 * orders they are canonical-hashed and committed on Monad with `commitPolicy`, but under their own
 * versioned schema and their own id range, so night orders (and their hashes) never change.
 */
export const AUTO_SESSION_BASE = 3_000_000_000;

export const AutoOrders = z.object({
  v: z.literal(1),
  kind: z.literal('auto'),
  /** The on-chain policy id of this session (≥ AUTO_SESSION_BASE, never a yyyymmdd night id). */
  session: z.number().int().min(AUTO_SESSION_BASE).max(0xffffffff),
  minutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240), z.literal(480)]),
  raidsPerHour: z.number().int().min(0).max(4),
  minWinPct: z.number().int().min(50).max(100),
  reserveGoldPct: z.number().int().min(0).max(80),
  upgradeFirst: z.enum(['defences', 'resources', 'army']),
  strikeBack: z.boolean(),
  /** Hale raises the storm-shield after a raid razes at least this much. */
  shieldAtPct: z.number().int().min(10).max(100),
});
export type AutoOrders = z.infer<typeof AutoOrders>;

/** What the player (and the Night Captain's draft) may set. */
export const AutoOrdersDraft = AutoOrders.pick({
  raidsPerHour: true,
  minWinPct: true,
  reserveGoldPct: true,
  upgradeFirst: true,
  strikeBack: true,
  shieldAtPct: true,
});
export type AutoOrdersDraft = z.infer<typeof AutoOrdersDraft>;

export const DEFAULT_AUTO_ORDERS: AutoOrdersDraft = {
  raidsPerHour: 2,
  minWinPct: 70,
  reserveGoldPct: 30,
  upgradeFirst: 'defences',
  strikeBack: true,
  shieldAtPct: 60,
};

/** A fresh on-chain id per session: minutes since 1970 above the night-id range. */
export const autoSessionId = (startMs: number, bump = 0) => AUTO_SESSION_BASE + (Math.floor(startMs / 60_000) % 1_000_000_000) + bump;
export const isAutoSessionId = (id: number) => id >= AUTO_SESSION_BASE;
export const autoOrdersHash = (o: AutoOrders) => canonicalHash(o);

export function describeAutoOrders(o: AutoOrdersDraft): string[] {
  return [
    o.raidsPerHour ? `Raid at most ${o.raidsPerHour} time${o.raidsPerHour === 1 ? '' : 's'} an hour.` : 'Never raid.',
    `Only raid if the War Room's win chance is at least ${o.minWinPct}%.`,
    `Keep ${o.reserveGoldPct}% of the Gold storage in reserve.`,
    `Upgrade ${o.upgradeFirst} first.`,
    o.strikeBack ? 'Strike back at raiders.' : 'Never strike back.',
    `Raise the storm-shield if a raid takes ${o.shieldAtPct}% or more.`,
  ];
}

/** Auto action kinds (u8 on-chain; 1–4 are the night kinds). */
export const AUTO_KINDS = { collect: 5, build: 6, upgrade: 7, raid: 8, reseal: 9, layout: 10, repair: 11, strikeback: 12, shield: 13 } as const;
export type AutoKind = keyof typeof AUTO_KINDS;

export interface AutoAction {
  kind: AutoKind;
  detail: {
    /** build / upgrade: the Gold left afterwards and the reserve the orders keep. */
    goldAfter?: number;
    reserveGold?: number;
    /** raid: the best practice win chance and raids already made in the last hour. */
    winPct?: number;
    raidsLastHour?: number;
    /** shield: how much the raid razed. */
    lossPct?: number;
    [k: string]: unknown;
  };
}

/**
 * The officers' hard gate: an action is allowed only if the sealed Auto Orders allow it. It runs
 * before anything is logged on-chain or done; the contract then checks the orders' hash.
 */
export function isAutoActionAllowed(o: AutoOrders, a: AutoAction): { ok: boolean; reason?: string } {
  const d = a.detail;
  switch (a.kind) {
    case 'collect':
    case 'reseal':
    case 'layout':
    case 'repair':
      return { ok: true };
    case 'build':
    case 'upgrade':
      if (d.goldAfter === undefined || d.reserveGold === undefined) return { ok: false, reason: 'no budget given' };
      return d.goldAfter >= d.reserveGold
        ? { ok: true }
        : { ok: false, reason: `would leave ${d.goldAfter} Gold, orders keep ${d.reserveGold}` };
    case 'raid':
      if (!o.raidsPerHour) return { ok: false, reason: 'orders say never raid' };
      if ((d.raidsLastHour ?? 99) >= o.raidsPerHour) return { ok: false, reason: `already ${d.raidsLastHour} raid${d.raidsLastHour === 1 ? '' : 's'} this hour` };
      return (d.winPct ?? -1) >= o.minWinPct ? { ok: true } : { ok: false, reason: `win chance ${d.winPct}%, orders need ${o.minWinPct}%` };
    case 'strikeback':
      return o.strikeBack ? { ok: true } : { ok: false, reason: 'orders say never strike back' };
    case 'shield':
      return (d.lossPct ?? 0) >= o.shieldAtPct ? { ok: true } : { ok: false, reason: `losses below ${o.shieldAtPct}%` };
  }
}

export type AutoOfficer = 'general' | 'architect' | 'strategist' | 'night_captain' | 'intel';
export type AutoStatus = 'running' | 'finished' | 'stopped' | 'out_of_gems';

export interface AutoLogEntry {
  at: number;
  officer: AutoOfficer;
  kind: AutoKind | 'note';
  text: string;
  /** Actions only: ✓ within orders / ✗ refused. Notes are always true. */
  allowed: boolean;
  reason?: string;
  actionHash: Hex | null;
  tx: TxRef | null;
  battleId?: string;
}

export interface AutoSessionDTO {
  id: string;
  status: AutoStatus;
  orders: AutoOrders;
  ordersHash: Hex;
  summary: string[];
  commitTx: TxRef | null;
  startedAt: number;
  endsAt: number;
  endedAt: number | null;
  gemsSpent: number;
  moves: number;
  /** Beats still to run (a resumed offline realm catches up on them). */
  behind: number;
  log: AutoLogEntry[];
}

export const AUTO_BLOCKED = 'Auto Mode is running — tap Take Control to play yourself.';
