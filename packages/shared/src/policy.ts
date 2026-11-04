import { z } from 'zod';
import { canonicalHash } from './canonical';

/** Tonight's autopilot orders (§14.3). Committed on-chain as `policyHash`. */
export const NightPolicy = z.object({
  v: z.literal(1),
  night: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  repairPriority: z.enum(['walls', 'defenses', 'resources']),
  reserveGoldPct: z.number().int().min(0).max(80),
  autoRetaliate: z.boolean(),
  maxRetaliateCitadelDelta: z.number().int().min(-2).max(2),
  shieldIfLossesOverPct: z.number().int().min(10).max(100),
});
export type NightPolicy = z.infer<typeof NightPolicy>;

/** The fields the Night Captain may draft (the LLM never sets v or night). */
export const PolicyDraft = NightPolicy.omit({ v: true, night: true });
export type PolicyDraft = z.infer<typeof PolicyDraft>;

export const policyHash = (p: NightPolicy) => canonicalHash(p);

/** yyyymmdd as a number (the contract's nightId). */
export function nightIdOf(night: string): number {
  return Number(night.replace(/-/g, ''));
}

export function nightOf(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Default orders: repair walls first, keep 30 % gold, retaliate only vs ≤ my Citadel level. */
export function defaultPolicy(night: string): NightPolicy {
  return {
    v: 1,
    night,
    repairPriority: 'walls',
    reserveGoldPct: 30,
    autoRetaliate: true,
    maxRetaliateCitadelDelta: 0,
    shieldIfLossesOverPct: 60,
  };
}

export function describePolicy(p: NightPolicy): string[] {
  return [
    `Repair ${p.repairPriority === 'defenses' ? 'defences' : p.repairPriority} first after each attack.`,
    `Keep ${p.reserveGoldPct}% of the treasury out of raiders' reach.`,
    p.autoRetaliate
      ? `Strike back at raiders whose Citadel is at most ${p.maxRetaliateCitadelDelta >= 0 ? `${p.maxRetaliateCitadelDelta} above` : `${-p.maxRetaliateCitadelDelta} below`} ours.`
      : 'Never strike back on our own.',
    `Raise the storm-shield if a raid takes ${p.shieldIfLossesOverPct}% or more.`,
  ];
}

/** Autopilot action kinds (u8 on-chain). */
export const AUTOPILOT_KINDS = { repair: 1, reserve: 2, retaliate: 3, shield: 4 } as const;
export type AutopilotKind = keyof typeof AUTOPILOT_KINDS;

export interface AutopilotAction {
  kind: AutopilotKind;
  /** repair: which category; reserve: gold protected; retaliate: target + citadel delta; shield: loss %. */
  detail: {
    category?: NightPolicy['repairPriority'];
    protectedGold?: number;
    targetCitadelDelta?: number;
    lossPct?: number;
    attackId?: string;
  };
}

/**
 * The Night Captain's hard gate: an action is allowed only if the sealed orders allow it.
 * The server runs this before anything is logged on-chain; the contract then checks the hash.
 */
export function isActionAllowed(p: NightPolicy, a: AutopilotAction): { ok: boolean; reason?: string } {
  switch (a.kind) {
    case 'repair':
      return a.detail.category === p.repairPriority
        ? { ok: true }
        : { ok: false, reason: `orders say repair ${p.repairPriority} first` };
    case 'reserve':
      return (a.detail.protectedGold ?? -1) >= 0 ? { ok: true } : { ok: false, reason: 'bad reserve amount' };
    case 'retaliate':
      if (!p.autoRetaliate) return { ok: false, reason: 'orders forbid retaliation' };
      return (a.detail.targetCitadelDelta ?? 99) <= p.maxRetaliateCitadelDelta
        ? { ok: true }
        : { ok: false, reason: 'target Citadel is above the allowed delta' };
    case 'shield':
      return (a.detail.lossPct ?? 0) >= p.shieldIfLossesOverPct
        ? { ok: true }
        : { ok: false, reason: 'losses below the shield threshold' };
  }
}
