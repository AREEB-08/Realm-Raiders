import { z } from 'zod';
import type { Action, ArmyComp, SealedBase } from '@realm/battle-engine';
import type { Coaching, Difficulty, Layout, OfficerRole, PlanId, Side } from '@realm/game-data';
import { Appearance, FACTION_IDS, PERSONALITY_IDS } from './appearance';
import type { Hex } from './canonical';
import { NightPolicy } from './policy';
import { AutoOrdersDraft, type AutoStatus } from './auto';

// ------------------------------------------------------------ request bodies ---

export const LayoutSchema = z.object({
  v: z.literal(1),
  buildings: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        type: z.string(),
        level: z.number().int().min(1).max(5),
        x: z.number().int().min(0).max(29),
        y: z.number().int().min(0).max(29),
      }),
    )
    .max(400),
});

export const Bodies = {
  authSession: z.object({ authToken: z.string().min(10), address: z.string().optional() }),
  collect: z.object({ buildingId: z.string() }),
  putGeneral: z.object({
    name: z.string().trim().min(2).max(24),
    personality: z.enum(PERSONALITY_IDS),
    faction: z.enum(FACTION_IDS),
    appearance: Appearance,
  }),
  portrait: z.object({ png: z.string().max(420_000) }),
  txConfirm: z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }),
  putLayout: z.object({ layout: LayoutSchema }),
  build: z.object({
    type: z.string(),
    x: z.number().int().min(0).max(29),
    y: z.number().int().min(0).max(29),
  }),
  buildWalls: z.object({ tiles: z.array(z.object({ x: z.number().int(), y: z.number().int() })).max(60) }),
  upgrade: z.object({ buildingId: z.string() }),
  hurry: z.object({ buildingId: z.string() }),
  sealRelay: z.object({
    signature: z.string().optional(),
    deadline: z.number().int().optional(),
  }),
  warroom: z.object({ targetIslandId: z.string() }),
  coach: z.object({ planId: z.string(), note: z.string().max(200) }),
  commit: z.object({
    warRoomId: z.string(),
    planId: z.string(),
    duelId: z.string().optional(),
    attackerNonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  }),
  submit: z.object({ replay: z.string().max(700_000) }),
  policy: z.object({ policy: NightPolicy.omit({ v: true, night: true }).partial().optional() }),
  policyConfirm: z.object({
    txHash: z.string().optional(),
    signature: z.string().optional(),
    deadline: z.number().int().optional(),
  }),
  applyPatch: z.object({ reportId: z.string().optional() }),
  autoPrepare: z.object({
    minutes: z.union([z.literal(30), z.literal(60), z.literal(120), z.literal(240), z.literal(480)]),
    orders: AutoOrdersDraft,
  }),
  demoAuth: z.object({ deviceId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional() }),
  lanJoin: z.object({ code: z.string().trim().regex(/^[A-Za-z]{4}$/) }),
  lanStatus: z.object({ ready: z.boolean().optional() }),
  lanEmote: z.object({ emote: z.enum(['hello', 'good_luck', 'well_played', 'rematch']) }),
  duelInvite: z.object({ to: z.string().min(1).max(64) }),
  autoConfirm: z.object({
    txHash: z.string().optional(),
    signature: z.string().optional(),
    deadline: z.number().int().optional(),
  }),
  agentTask: z.record(z.string(), z.unknown()),
} as const;

// -------------------------------------------------------------------- DTOs ---

export type ChainMode = 'mock' | 'live';

export interface TxRef {
  kind: string;
  hash: Hex;
  mode: ChainMode;
  url: string | null;
  block?: number;
}

export interface Resources {
  gold: number;
  timber: number;
  ember: number;
  renown: number;
}

export interface ProducerState {
  buildingId: string;
  resource: 'gold' | 'timber' | 'ember';
  pending: number;
  cap: number;
  perSecond: number;
}

export interface UpgradeTimer {
  buildingId: string;
  toLevel: number;
  /** ms epoch; null when it is a new building waiting to finish. */
  readyAt: number;
}

export interface EconomyDTO extends Resources {
  cap: { gold: number; timber: number; ember: number };
  producers: ProducerState[];
  builders: { total: number; busy: number };
  armyCapacity: number;
  troopLevel: number;
  /** In-game Gems (earned only). */
  gems: number;
  /** Storm-shield end time (ms), 0 = none. */
  shieldUntil: number;
}

export interface GeneralDTO {
  name: string;
  personality: (typeof PERSONALITY_IDS)[number];
  faction: (typeof FACTION_IDS)[number];
  appearance: Appearance;
  appearanceHash: Hex;
  agentId: string | null;
  agentTx: TxRef | null;
  portraitUrl: string | null;
  level: number;
}

export interface BaseDTO {
  layout: Layout;
  version: number;
  currentHash: Hex;
  sealedHash: Hex | null;
  sealTx: TxRef | null;
  sealedAt: number | null;
  dirty: boolean;
  timers: UpgradeTimer[];
  citadelLevel: number;
}

export interface OfficerDTO {
  role: OfficerRole;
  title: string;
  name: string;
  news: boolean;
}

export interface EventCard {
  id: string;
  icon: 'raid' | 'seal' | 'night' | 'badge' | 'upgrade';
  title: string;
  body: string;
  at: number;
  tx?: TxRef | null;
}

export interface HomeDTO {
  player: { id: string; address: Hex; isGuest: boolean };
  general: GeneralDTO | null;
  base: BaseDTO;
  economy: EconomyDTO;
  events: EventCard[];
  officers: OfficerDTO[];
  pendingReport: { reportId: string; nightId: number } | null;
  rank: { name: string; min: number; next: { name: string; min: number } | null };
  chainMode: ChainMode;
  activePolicy: { nightId: number; policyHash: Hex; expiresAt: number } | null;
  /** The running Auto Mode session, or the last one if it ended and the player hasn't seen it yet. */
  auto: { id: string; status: AutoStatus; endsAt: number; moves: number; behind: number } | null;
  now: number;
}

/** One change to the Gem balance (spec F7): "+5 First raid today", "−4 Auto Mode 1 hour". */
export interface GemEntryDTO {
  id: string;
  delta: number;
  label: string;
  at: number;
}

export interface GemsDTO {
  balance: number;
  history: GemEntryDTO[];
}

export interface TargetDTO {
  /** A commander in your LAN room (their sealed base), not a rival lord. */
  friend?: boolean;
  islandId: string;
  name: string;
  ownerName: string;
  blurb: string;
  baseHash: Hex;
  sealedAt: number | null;
  sealed: boolean;
  citadelLvl: number;
  lootEst: { gold: number; timber: number };
  difficulty: Difficulty;
  intel: string;
  recommended: boolean;
  layout: Layout;
}

export interface PlanStats {
  n: number;
  winRate: number;
  avgStars: number;
  avgDestruction: number;
  p10: number;
  p90: number;
  /** Average battle length in seconds (faster = cleaner raid). */
  avgSeconds: number;
}

export interface PlanDTO {
  planId: PlanId;
  name: string;
  summary: string;
  side: Side;
  coaching: Coaching;
  coachNote: string | null;
  army: ArmyComp;
  actions: Action[];
  stats: PlanStats | null;
  cost: { timber: number; ember: number };
  affordable: boolean;
  tip: string;
}

export interface AgentMeta {
  fallback: boolean;
  latencyMs: number;
}

export interface WarRoomDTO {
  warRoomId: string;
  target: TargetDTO;
  plans: PlanDTO[];
  recommended: PlanId;
  thoughts: string[];
  agent: AgentMeta;
}

export interface BattleCommitDTO {
  battleId: string;
  seed: Hex;
  commitTx: TxRef;
  revealTx: TxRef;
  chainMode: ChainMode;
  base: SealedBase;
  baseHash: Hex;
  army: ArmyComp;
  plan: PlanDTO;
  targetName: string;
  attackerCitadel: number;
  defenderStored: { gold: number; timber: number };
  /** The engine version the server fixed for this battle (the replay must use it). */
  engineVersion: number;
  /** Raid a friend: stream the applied actions so they can watch live. */
  live?: boolean;
  /** Live Duel: both commanders share this battle's seed. */
  duelId?: string;
}

// ------------------------------------------------------------- LAN (spec F9) ---

export const EMOTES = { hello: 'Hello!', good_luck: 'Good luck!', well_played: 'Well played!', rematch: 'Rematch?' } as const;
export type EmoteId = keyof typeof EMOTES;
export type LobbyStatus = 'island' | 'raiding' | 'auto' | 'duel';
export const LOBBY_STATUS: Record<LobbyStatus, string> = { island: 'On island', raiding: 'Raiding', auto: 'Auto Mode', duel: 'In duel' };

export interface LobbyPlayerDTO {
  playerId: string;
  name: string;
  status: LobbyStatus;
  ready: boolean;
  online: boolean;
  sealed: boolean;
  renown: number;
  portraitUrl: string | null;
}

export interface LobbyDTO {
  room: string;
  hostName: string;
  me: string;
  players: LobbyPlayerDTO[];
}

export interface DuelSideDTO {
  playerId: string;
  name: string;
  warRoomId: string | null;
  battleId: string | null;
  stars: number | null;
  destructionPct: number | null;
  seconds: number | null;
  live: { stars: number; pct: number } | null;
  online: boolean;
}

export interface DuelDTO {
  duelId: string;
  status: 'invited' | 'live' | 'decided' | 'declined';
  a: DuelSideDTO;
  b: DuelSideDTO;
  seedTx: TxRef | null;
  startsAt: number;
  endsAt: number;
  /** playerId of the winner, 'draw', or null until decided. */
  winner: string | null;
  decidedBy: 'replays' | 'disconnect' | 'timeout' | null;
  resultTx: TxRef | null;
}

export interface SpectateDTO {
  battleId: string;
  attacker: string;
  defender: string;
  input: { engineVersion: number; seed: Hex; base: SealedBase; army: ArmyComp };
  /** Actions streamed so far, and the last tick the attacker reported. */
  actions: Action[];
  tick: number;
  ended: boolean;
}

export interface IntelReport {
  headline: string;
  keyMoments: { tick: number; text: string }[];
  opponentNotes: string[];
}

export interface BattleSubmitDTO {
  battleId: string;
  verified: boolean;
  reasons: string[];
  result: {
    stars: number;
    destructionPct: number;
    destructionBp: number;
    renown: number;
    loot: { gold: number; timber: number };
  } | null;
  replayHash: Hex;
  resultHash: Hex | null;
  seedTx: TxRef | null;
  resultTx: TxRef | null;
  feedbackTx: TxRef | null;
  badges: { id: number; name: string; tx: TxRef | null }[];
  /** Gems this raid earned ("First raid today", "3-star raid"); badges add their own +10. */
  gems?: { delta: number; label: string }[];
  /** Live Duel: the duel as it stands after this replay (decided once both are in). */
  duel?: DuelDTO;
  report: IntelReport;
  agent: AgentMeta;
}

export interface BattleDTO {
  battleId: string;
  kind: 'raid' | 'night' | 'duel';
  status: 'committed' | 'submitted' | 'verified' | 'rejected' | 'recorded';
  attacker: string;
  defender: string;
  seed: Hex;
  baseHash: Hex;
  replayHash: Hex | null;
  stars: number | null;
  destructionBp: number | null;
  renown: number | null;
  commitTx: TxRef | null;
  resultTx: TxRef | null;
  createdAt: number;
}

export interface NightPolicyDTO {
  policy: NightPolicy;
  policyHash: Hex;
  nightId: number;
  expiresAt: number;
  commitTx: TxRef | null;
  sealed: boolean;
  summary: string[];
}

export interface NightAttackDTO {
  battleId: string;
  attacker: string;
  attackerCitadel: number;
  stars: number;
  destructionPct: number;
  renownDelta: number;
  blocked: boolean;
  resultTx: TxRef | null;
}

export interface NightActionDTO {
  kind: 'repair' | 'reserve' | 'retaliate' | 'shield';
  text: string;
  allowed: boolean;
  reason?: string;
  actionHash: Hex | null;
  tx: TxRef | null;
}

export interface LayoutMove {
  buildingId: string;
  x: number;
  y: number;
}

export interface LayoutAnalysis {
  quadrants: { name: 'north' | 'east' | 'south' | 'west'; coverage: number }[];
  citadelCoverage: number;
  coveredCitadelPct: number;
  exposedStorages: string[];
  defenceCount: number;
  wallCount: number;
}

export interface ArchitectReview {
  tips: string[];
  patch: { moves: LayoutMove[]; rationale: string } | null;
  before: LayoutAnalysis;
  after: LayoutAnalysis | null;
  agent: AgentMeta;
}

export interface NightReportDTO {
  reportId: string;
  nightId: number;
  policyHash: Hex;
  policyTx: TxRef | null;
  attacks: NightAttackDTO[];
  actions: NightActionDTO[];
  renownDelta: number;
  intel: IntelReport;
  architect: ArchitectReview;
  createdAt: number;
}


export interface ProfileDTO {
  player: { id: string; address: Hex };
  general: GeneralDTO | null;
  rank: { name: string; min: number; next: { name: string; min: number } | null };
  renown: number;
  record: { raidsWon: number; raidsLost: number; defencesWon: number; defencesLost: number };
  badges: { id: number; name: string; desc: string; earned: boolean }[];
  reputation: { count: number; average: number; source: 'chain' | 'cached' };
  battles: BattleDTO[];
  line: string;
  agent: AgentMeta;
  chainMode: ChainMode;
  contracts: Record<string, string>;
}

export interface SessionDTO {
  session: string;
  playerId: string;
  address: Hex;
  isNew: boolean;
}

export interface AgentResponse<T = unknown> {
  output: T;
  fallback: boolean;
  latencyMs: number;
}

export interface HealthDTO {
  ok: boolean;
  db: boolean;
  chain: { mode: ChainMode; ok: boolean; block?: number };
  llm: { mode: 'live' | 'offline'; model: string | null };
  relayerBalance: string | null;
}
