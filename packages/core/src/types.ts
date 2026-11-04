import type { ArmyComp, SealedBase } from '@realm/battle-engine';
import type { Difficulty, Layout, PlanId } from '@realm/game-data';
import type {
  AgentMeta,
  Appearance,
  AutoLogEntry,
  AutoOrders,
  AutoStatus,
  ArchitectReview,
  EventCard,
  Hex,
  IntelReport,
  LayoutMove,
  NightActionDTO,
  NightAttackDTO,
  NightPolicy,
  PlanDTO,
  TxRef,
} from '@realm/shared';

/** Every stored document has a string id (for per-player docs it is the player id). */
export interface Doc {
  id: string;
}

export interface PlayerDoc extends Doc {
  authSub: string;
  address: Hex;
  createdAt: number;
  isGuest: boolean;
  /** Demo/NPC burner key held by the server (never for real wallet players). */
  burnerKey: Hex | null;
  npcKey: string | null;
}

export interface GeneralDoc extends Doc {
  name: string;
  personality: 'bold' | 'cunning' | 'steadfast' | 'merry';
  faction: Appearance['faction'];
  appearance: Appearance;
  appearanceHash: Hex;
  agentId: string | null;
  agentTx: TxRef | null;
  portrait: string | null;
  firstLine: string | null;
}

export interface BaseDoc extends Doc {
  layout: Layout;
  version: number;
  sealedHash: Hex | null;
  sealedVersion: number | null;
  sealedLayout: Layout | null;
  sealTx: TxRef | null;
  sealedAt: number | null;
  timers: Record<string, { toLevel: number; readyAt: number }>;
  collectedAt: Record<string, number>;
  pendingPatch: { moves: LayoutMove[]; rationale: string; reportId: string | null } | null;
  nextSeq: number;
}

export interface ResourcesDoc extends Doc {
  gold: number;
  timber: number;
  ember: number;
  renown: number;
  updatedAt: number;
  stats: { raidsWon: number; raidsLost: number; defWon: number; defLost: number; nightWatchWins: number };
  badges: number[];
  badgeTxs: Record<string, TxRef | null>;
  events: EventCard[];
  shieldUntil: number;
  /** In-game Gems (earned only, spec F7). Absent on older saves = STARTING_GEMS. */
  gems?: number;
  /** UTC days (yyyy-mm-dd) the once-a-day Gem rewards were last paid. */
  gemDays?: { login?: string; firstRaid?: string };
}

/** One change to a player's Gems (spec F7). Auto Mode charges add up in one row per session. */
export interface GemLogDoc extends Doc {
  playerId: string;
  delta: number;
  reason: 'start' | 'daily' | 'first_raid' | 'three_star' | 'badge' | 'duel' | 'auto';
  label: string;
  at: number;
}

/** An Auto Mode session (spec F8): sealed orders, paid 30-minute blocks and the Auto Log. */
export interface AutoSessionDoc extends Doc {
  playerId: string;
  /** On-chain policy id (≥ AUTO_SESSION_BASE). */
  chainId: number;
  orders: AutoOrders;
  ordersHash: Hex;
  commitTx: TxRef | null;
  sealed: boolean;
  status: AutoStatus | 'draft';
  startedAt: number;
  endsAt: number;
  endedAt: number | null;
  /** Index of the next beat to run (beat k happens at startedAt + k x AUTO_BEAT_MINUTES). */
  beat: number;
  blocksPaid: number;
  moves: number;
  /** War Rooms already run this session, by target + army size (the practice raids don't change). */
  rooms: Record<string, string>;
  raidTimes: number[];
  lastCollectAt: number | null;
  lastSealAt: number | null;
  /** Upgrades and builds finished since the last seal ("Base re-sealed after 2 changes"). */
  changes: number;
  patched: boolean;
  log: AutoLogEntry[];
  seen: boolean;
  createdAt: number;
}

export interface IslandDoc extends Doc {
  ownerPlayerId: string | null;
  npcKey: string | null;
  name: string;
  ownerName: string;
  difficulty: Difficulty;
  blurb: string;
  stored: { gold: number; timber: number };
  layout: Layout;
}

export interface WarRoomDoc extends Doc {
  playerId: string;
  targetIslandId: string;
  plans: PlanDTO[];
  recommended: PlanId;
  thoughts: string[];
  agent: AgentMeta;
  status: 'simulating' | 'ready';
  createdAt: number;
}

export type BattleStatus = 'committed' | 'submitted' | 'verified' | 'rejected' | 'recorded';

export interface BattleDoc extends Doc {
  kind: 'raid' | 'night' | 'duel';
  /** Live Duel this battle belongs to (kind 'duel'). */
  duelId?: string | null;
  /** Bytes32 id used on-chain: keccak256(utf8(id)). */
  chainBattleId: Hex;
  attackerId: string;
  attackerAddress: Hex;
  attackerName: string;
  defenderId: string;
  defenderAddress: Hex;
  defenderName: string;
  islandId: string | null;
  planId: PlanId | null;
  seed: Hex;
  secret: Hex;
  attackerNonce: Hex;
  commitTx: TxRef | null;
  revealTx: TxRef | null;
  baseHash: Hex;
  base: SealedBase;
  army: ArmyComp;
  /** Engine version fixed when the battle was committed (absent on launch-era docs = 1). */
  engineVersion?: number;
  attackerCitadel: number;
  defenderStored: { gold: number; timber: number };
  replay: string | null;
  replayHash: Hex | null;
  stars: number | null;
  destructionBp: number | null;
  renown: number | null;
  loot: { gold: number; timber: number } | null;
  resultTx: TxRef | null;
  feedbackTx: TxRef | null;
  status: BattleStatus;
  report: IntelReport | null;
  createdAt: number;
}

export interface PolicyDoc extends Doc {
  playerId: string;
  nightId: number;
  policy: NightPolicy;
  policyHash: Hex;
  commitTx: TxRef | null;
  expiresAt: number;
  sealed: boolean;
  createdAt: number;
}

export interface ReportDoc extends Doc {
  playerId: string;
  policyId: string;
  nightId: number;
  policyHash: Hex;
  policyTx: TxRef | null;
  attacks: NightAttackDTO[];
  actions: NightActionDTO[];
  renownDelta: number;
  intel: IntelReport;
  architect: ArchitectReview;
  seen: boolean;
  createdAt: number;
}

export interface AgentMemoryDoc extends Doc {
  playerId: string;
  role: string;
  kind: 'fact' | 'summary' | 'preference';
  content: string;
  createdAt: number;
}

export interface AgentLogDoc extends Doc {
  playerId: string;
  role: string;
  task: string;
  inputHash: string;
  output: unknown;
  latencyMs: number;
  fallback: boolean;
  createdAt: number;
}

export interface TxDoc extends Doc {
  kind: string;
  payload: unknown;
  status: 'pending' | 'sent' | 'confirmed' | 'failed';
  hash: string | null;
  attempts: number;
  error: string | null;
  createdAt: number;
}

export interface KvDoc extends Doc {
  value: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}
