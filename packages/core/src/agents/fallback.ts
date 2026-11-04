/**
 * Deterministic "field manual" answers for every officer (§14.1 rule 5). Used offline, when the
 * LLM times out or returns invalid output — the demo can never stall on the model.
 */
import type { BattleResult, SimEvent } from '@realm/battle-engine';
import { BUILDINGS, troopPlural, type BuildingId, type TroopId } from '@realm/game-data';
import {
  defaultPolicy,
  type ArchitectOutput,
  type GeneralOutput,
  type IntelOutput,
  type LayoutAnalysis,
  type NightCaptainOutput,
  type PlanDTO,
  type StrategistOutput,
  type TargetDTO,
} from '@realm/shared';

export const mmss = (tick: number) => {
  const s = Math.floor(tick / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const OPENERS: Record<string, (name: string) => string> = {
  bold: (n) => `I am ${n} the Bold. Point me at a wall and I will show you its other side.`,
  cunning: (n) => `${n}, at your service. Every holdfast has a weak seam; I intend to find it.`,
  steadfast: (n) => `I am ${n}. Whatever storm comes, this banner does not fall.`,
  merry: (n) => `${n} here! Fetch the ale — we have islands to visit and songs to earn.`,
};

export function generalGreeting(name: string, personality: string): GeneralOutput {
  return { greeting: (OPENERS[personality] ?? OPENERS.steadfast!)(name), briefing: [], suggestedTarget: null };
}

export function generalBriefing(f: {
  name: string;
  personality: string;
  gold: number;
  timber: number;
  renown: number;
  dirty: boolean;
  sealed: boolean;
  pendingReport: boolean;
  target: TargetDTO | null;
}): GeneralOutput {
  const hello: Record<string, string> = {
    bold: `Morning, commander. The blades are sharp and the war-carts are ready.`,
    cunning: `Good day. I've had the scouts out since dawn.`,
    steadfast: `All quiet on the walls, commander. Here is where we stand.`,
    merry: `Up and at them! The crows say there's gold beyond the trees.`,
  };
  const briefing: string[] = [];
  if (f.pendingReport) briefing.push('The Night Captain has a report waiting from last night.');
  if (!f.sealed) briefing.push('Our base isn’t saved yet — tap Build, then Save.');
  else if (f.dirty) briefing.push('You moved buildings since the last save — save again to keep it.');
  if (f.target)
    briefing.push(
      `I'd raid ${f.target.name}: about ${f.target.lootEst.gold + f.target.lootEst.timber} in loot for a ${f.target.difficulty} fight.`,
    );
  briefing.push(`Treasury: ${f.gold} gold, ${f.timber} timber. Renown ${f.renown}.`);
  return {
    greeting: hello[f.personality] ?? hello.steadfast!,
    briefing: briefing.slice(0, 3),
    suggestedTarget: f.target?.islandId ?? null,
  };
}

export function generalProfileLine(name: string, wins: number, losses: number, renown: number): GeneralOutput {
  const line =
    wins + losses === 0
      ? `${name} has yet to draw steel in earnest. The songs are still unwritten.`
      : wins >= losses
        ? `${wins} raid${wins === 1 ? '' : 's'} won, ${losses} lost, ${renown} Renown. ${name} sleeps well.`
        : `${losses} setbacks, ${wins} victories. ${name} is learning, and learning fast.`;
  return { greeting: line, briefing: [], suggestedTarget: null };
}

export function architectTips(a: LayoutAnalysis, patchRationale: string | null): ArchitectOutput {
  const tips: string[] = [];
  const weakest = [...a.quadrants].sort((x, y) => x.coverage - y.coverage)[0]!;
  if (weakest.coverage < 70)
    tips.push(`The ${weakest.name} flank is only ${weakest.coverage}% covered by towers; move a defence that way.`);
  if (a.citadelCoverage < Math.min(2, a.defenceCount))
    tips.push(`Only ${a.citadelCoverage} of ${a.defenceCount} defences reach the Citadel. Keep it inside their range.`);
  if (a.exposedStorages.length)
    tips.push(`${a.exposedStorages.length} store${a.exposedStorages.length > 1 ? 's sit' : ' sits'} outside the walls — raiders will walk straight in.`);
  if (tips.length < 3 && a.wallCount < 20) tips.push(`Just ${a.wallCount} wall segments. A closed ring forces raiders to break through.`);
  if (!tips.length) tips.push(`Solid work: every side is at least ${weakest.coverage}% covered. Save it.`);
  return { tips: tips.slice(0, 3), rationale: patchRationale ?? undefined };
}

export function strategistBrief(plans: PlanDTO[], targetName: string): StrategistOutput {
  const ranked = [...plans].sort(
    (a, b) =>
      (b.stats?.winRate ?? 0) - (a.stats?.winRate ?? 0) ||
      (b.stats?.avgDestruction ?? 0) - (a.stats?.avgDestruction ?? 0) ||
      (a.stats?.avgSeconds ?? 0) - (b.stats?.avgSeconds ?? 0),
  );
  const best = ranked[0]!;
  const thoughts = [
    `Fifty practice raids each against ${targetName}.`,
    `${best.name} wins ${best.stats?.winRate ?? 0}% with ${best.stats?.avgDestruction ?? 0}% razed on average.`,
  ];
  const worst = ranked[ranked.length - 1]!;
  const gap = (best.stats?.avgDestruction ?? 0) - (worst.stats?.avgDestruction ?? 0);
  if (worst !== best && (gap >= 10 || (best.stats?.winRate ?? 0) - (worst.stats?.winRate ?? 0) >= 10))
    thoughts.push(`${worst.name} stalls at ${worst.stats?.avgDestruction ?? 0}% — I'd not lead with it.`);
  else if (worst !== best)
    thoughts.push(`All three plans take it; ${best.name} is the fastest at ${best.stats?.avgSeconds ?? 0}s.`);
  const tips: Record<string, string> = {};
  for (const p of plans) tips[p.planId] = planTip(p);
  return { thoughts, recommended: best.planId, tips };
}

export function planTip(p: PlanDTO): string {
  const s = p.stats;
  if (!s) return 'Waiting on the practice runs.';
  if (p.planId === 'drake_raid' && s.avgDestruction < 50) return 'The Wyrm Ballista is shooting our Dragon down — try another side, or send Giants.';
  if (p.planId === 'sapper_breach') return s.winRate < 60 ? 'Let the Giants reach the wall before the Sappers run ("wait for walls").' : 'The Giants hold the towers; the breach works.';
  if (p.planId === 'shieldwall' && s.avgStars < 2.5 && s.winRate > 0) return 'Swordsmen melt under splash — Mages or Giants would hold better here.';
  if (s.avgDestruction < 50) return 'Hit from a flank with fewer towers.';
  if (s.p90 - s.p10 > 40) return 'Results swing a lot; a later Rally may steady it.';
  return 'Sound plan. Rally when the line reaches the Citadel.';
}

export function strategistCommentary(snap: {
  tick: number;
  destructionPct: number;
  stars: number;
  alive: number;
  lastEvent?: string;
}): StrategistOutput {
  const at = mmss(snap.tick);
  let line: string;
  if (snap.stars >= 2) line = `${at} — two stars in hand. Press the Citadel side and finish it.`;
  else if (snap.destructionPct >= 50) line = `${at} — past half. One more push and the win is ours.`;
  else if (snap.alive === 0) line = `${at} — the line is down. Send what's left in the camp.`;
  else if (snap.lastEvent) line = `${at} — ${snap.lastEvent}`;
  else line = `${at} — ${snap.alive} raiders on the island, ${Math.round(snap.destructionPct)}% razed. Keep them moving.`;
  return { thoughts: [line] };
}

export function nightDraft(night: string, a: LayoutAnalysis | null, citadel: number): NightCaptainOutput {
  const p = defaultPolicy(night);
  const explanation = ['Walls first: a closed ring keeps the next raider out longer.'];
  if (a && a.exposedStorages.length) {
    p.reserveGoldPct = 45;
    explanation.push(`Two thirds of the gold is behind walls, so I keep 45% in reserve.`);
  } else explanation.push(`Keep 30% of the treasury out of reach.`);
  if (a && a.defenceCount <= 1) {
    p.repairPriority = 'defenses';
    explanation[0] = 'Towers first: with one defence, a broken tower means an open island.';
  }
  p.maxRetaliateCitadelDelta = citadel >= 3 ? 1 : 0;
  explanation.push(`Strike back only at holds of Citadel ${citadel + p.maxRetaliateCitadelDelta} or less.`);
  explanation.push(`Raise the storm-shield if a raid takes ${p.shieldIfLossesOverPct}% or more.`);
  return {
    policy: {
      repairPriority: p.repairPriority,
      reserveGoldPct: p.reserveGoldPct,
      autoRetaliate: p.autoRetaliate,
      maxRetaliateCitadelDelta: p.maxRetaliateCitadelDelta,
      shieldIfLossesOverPct: p.shieldIfLossesOverPct,
    },
    explanation,
  };
}

const bname = (t: BuildingId) => BUILDINGS[t].name;
const tname = (t: TroopId) => troopPlural(t);

/** Intel report from sim events: first defence down, % razed at 30/60/90 s, MVP troop. */
export function intelReport(
  r: Pick<BattleResult, 'events' | 'stars' | 'destructionPct' | 'damageBy' | 'endReason'>,
  totalWeightPct: (tick: number) => number,
  targetName: string,
  notes: string[] = [],
): IntelOutput {
  const ev = r.events as SimEvent[];
  const firstDef = ev.find(
    (e): e is Extract<SimEvent, { k: 'destroyed' }> => e.k === 'destroyed' && !!BUILDINGS[e.type].defence,
  );
  const citadel = ev.find((e): e is Extract<SimEvent, { k: 'destroyed' }> => e.k === 'destroyed' && e.type === 'citadel');
  const mvp = Object.entries(r.damageBy).sort((a, b) => b[1] - a[1])[0];
  const keyMoments: { tick: number; text: string }[] = [];
  if (firstDef) keyMoments.push({ tick: firstDef.t, text: `${mmss(firstDef.t)} first defence down: ${bname(firstDef.type)}.` });
  for (const t of [600, 1200, 1799]) {
    const end = ev.find((e) => e.k === 'end');
    if (end && end.t < t - 1) break;
    keyMoments.push({ tick: t, text: `${mmss(t)} — ${Math.round(totalWeightPct(t))}% razed.` });
  }
  if (citadel) keyMoments.push({ tick: citadel.t, text: `${mmss(citadel.t)} the Citadel of ${targetName} fell.` });
  if (mvp) keyMoments.push({ tick: 0, text: `MVP: the ${tname(mvp[0] as TroopId)}.` });
  keyMoments.sort((a, b) => a.tick - b.tick);
  const stars = '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars);
  const headline =
    r.stars === 3
      ? `${targetName} razed to the ground. ${stars}`
      : r.stars > 0
        ? `${targetName} breached — ${Math.round(r.destructionPct)}% razed. ${stars}`
        : `${targetName} held. We took ${Math.round(r.destructionPct)}%. ${stars}`;
  return { headline, keyMoments: keyMoments.slice(0, 5), opponentNotes: notes.slice(0, 3) };
}

export function opponentNotes(history: { stars: number; destructionPct: number; side?: string }[], blurb: string): string[] {
  if (!history.length) return [`No raids on record yet. Scouts say: ${blurb.toLowerCase()}`];
  const wins = history.filter((h) => h.stars > 0).length;
  const avg = Math.round(history.reduce((n, h) => n + h.destructionPct, 0) / history.length);
  return [`We have raided them ${history.length}× (won ${wins}), averaging ${avg}% razed.`];
}
