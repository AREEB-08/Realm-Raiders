import { blob, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { Repo } from '@realm/core';

/**
 * §16.2 tables. Each core document maps onto one table; nested data lives in JSON columns.
 * `spec` drives both the Drizzle table objects and the CREATE TABLE statements, so the two
 * can never drift. (Kind: text | int | bool | json | blob64 = base64 string ↔ BLOB.)
 */
type Kind = 'text' | 'int' | 'bool' | 'json' | 'blob64';
type Spec = { table: string; cols: Record<string, [string, Kind]>; index?: string[] };

export const spec: Record<keyof Repo, Spec> = {
  players: {
    table: 'player',
    cols: { id: ['id', 'text'], authSub: ['auth_sub', 'text'], address: ['address', 'text'], createdAt: ['created_at', 'int'], isGuest: ['is_guest', 'bool'], burnerKey: ['burner_key', 'text'], npcKey: ['npc_key', 'text'] },
    index: ['auth_sub'],
  },
  generals: {
    table: 'general',
    cols: { id: ['player_id', 'text'], name: ['name', 'text'], personality: ['personality', 'text'], faction: ['faction', 'text'], appearance: ['appearance_json', 'json'], appearanceHash: ['appearance_hash', 'text'], agentId: ['agent_id', 'text'], agentTx: ['agent_tx', 'json'], portrait: ['portrait', 'text'], firstLine: ['first_line', 'text'] },
  },
  bases: {
    table: 'base',
    cols: { id: ['player_id', 'text'], layout: ['layout_json', 'json'], version: ['version', 'int'], sealedHash: ['base_hash', 'text'], sealedVersion: ['sealed_version', 'int'], sealedLayout: ['sealed_layout_json', 'json'], sealTx: ['seal_tx', 'json'], sealedAt: ['sealed_at', 'int'], timers: ['timers_json', 'json'], collectedAt: ['collected_json', 'json'], pendingPatch: ['pending_patch_json', 'json'], nextSeq: ['next_seq', 'int'] },
  },
  resources: {
    table: 'resources',
    cols: { id: ['player_id', 'text'], gold: ['gold', 'int'], timber: ['timber', 'int'], ember: ['ember', 'int'], renown: ['renown', 'int'], updatedAt: ['updated_at', 'int'], stats: ['stats_json', 'json'], badges: ['badges_json', 'json'], badgeTxs: ['badge_txs_json', 'json'], events: ['events_json', 'json'], shieldUntil: ['shield_until', 'int'], gems: ['gems', 'int'], gemDays: ['gem_days_json', 'json'] },
  },
  islands: {
    table: 'island',
    cols: { id: ['id', 'text'], ownerPlayerId: ['owner_player_id', 'text'], npcKey: ['npc_key', 'text'], name: ['name', 'text'], ownerName: ['owner_name', 'text'], difficulty: ['difficulty', 'text'], blurb: ['blurb', 'text'], stored: ['stored_json', 'json'], layout: ['layout_json', 'json'] },
  },
  warRooms: {
    table: 'war_room',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], targetIslandId: ['target_island_id', 'text'], plans: ['plans_json', 'json'], recommended: ['recommended', 'text'], thoughts: ['thoughts_json', 'json'], agent: ['agent_json', 'json'], status: ['status', 'text'], createdAt: ['created_at', 'int'] },
    index: ['player_id'],
  },
  battles: {
    table: 'battle',
    cols: {
      id: ['id', 'text'], kind: ['kind', 'text'], chainBattleId: ['chain_battle_id', 'text'], attackerId: ['attacker_id', 'text'], attackerAddress: ['attacker_address', 'text'], attackerName: ['attacker_name', 'text'],
      defenderId: ['defender_id', 'text'], defenderAddress: ['defender_address', 'text'], defenderName: ['defender_name', 'text'], islandId: ['defender_island_id', 'text'], planId: ['plan_id', 'text'],
      seed: ['seed', 'text'], secret: ['secret', 'text'], attackerNonce: ['attacker_nonce', 'text'], commitTx: ['commit_tx', 'json'], revealTx: ['reveal_tx', 'json'], baseHash: ['base_hash', 'text'], base: ['base_json', 'json'],
      army: ['army_json', 'json'], engineVersion: ['engine_version', 'int'], duelId: ['duel_id', 'text'], attackerCitadel: ['attacker_citadel', 'int'], defenderStored: ['defender_stored_json', 'json'], replay: ['replay_bytes', 'blob64'], replayHash: ['replay_hash', 'text'], stars: ['stars', 'int'],
      destructionBp: ['destruction_bp', 'int'], renown: ['renown', 'int'], loot: ['loot_json', 'json'], resultTx: ['result_tx', 'json'], feedbackTx: ['feedback_tx', 'json'], status: ['status', 'text'], report: ['report_json', 'json'], createdAt: ['created_at', 'int'],
    },
    index: ['attacker_id', 'defender_id'],
  },
  policies: {
    table: 'night_policy',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], nightId: ['night_id', 'int'], policy: ['policy_json', 'json'], policyHash: ['policy_hash', 'text'], commitTx: ['commit_tx', 'json'], expiresAt: ['expires_at', 'int'], sealed: ['sealed', 'bool'], createdAt: ['created_at', 'int'] },
    index: ['player_id'],
  },
  reports: {
    // Deviation from §16.2: one row per morning report (the night_event rows are its attacks/actions arrays).
    table: 'night_report',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], policyId: ['policy_id', 'text'], nightId: ['night_id', 'int'], policyHash: ['policy_hash', 'text'], policyTx: ['policy_tx', 'json'], attacks: ['attacks_json', 'json'], actions: ['actions_json', 'json'], renownDelta: ['renown_delta', 'int'], intel: ['intel_json', 'json'], architect: ['architect_json', 'json'], seen: ['seen', 'bool'], createdAt: ['created_at', 'int'] },
    index: ['player_id'],
  },
  agentMemory: {
    table: 'agent_memory',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], role: ['role', 'text'], kind: ['kind', 'text'], content: ['content', 'text'], createdAt: ['created_at', 'int'] },
    index: ['player_id'],
  },
  agentLog: {
    table: 'agent_log',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], role: ['role', 'text'], task: ['task', 'text'], inputHash: ['input_hash', 'text'], output: ['output_json', 'json'], latencyMs: ['latency_ms', 'int'], fallback: ['fallback', 'bool'], createdAt: ['created_at', 'int'] },
  },
  txs: {
    table: 'tx_queue',
    cols: { id: ['id', 'text'], kind: ['kind', 'text'], payload: ['payload_json', 'json'], status: ['status', 'text'], hash: ['hash', 'text'], attempts: ['attempts', 'int'], error: ['error', 'text'], createdAt: ['created_at', 'int'] },
  },
  kv: { table: 'kv', cols: { id: ['key', 'text'], value: ['value_json', 'json'] } },
  gemLog: {
    table: 'gem_log',
    cols: { id: ['id', 'text'], playerId: ['player_id', 'text'], delta: ['delta', 'int'], reason: ['reason', 'text'], label: ['label', 'text'], at: ['at', 'int'] },
    index: ['player_id'],
  },
  autoSessions: {
    table: 'auto_sessions',
    cols: {
      id: ['id', 'text'], playerId: ['player_id', 'text'], chainId: ['chain_id', 'int'], orders: ['orders_json', 'json'], ordersHash: ['orders_hash', 'text'], commitTx: ['commit_tx', 'json'],
      sealed: ['sealed', 'bool'], status: ['status', 'text'], startedAt: ['started_at', 'int'], endsAt: ['ends_at', 'int'], endedAt: ['ended_at', 'int'], beat: ['beat', 'int'],
      blocksPaid: ['blocks_paid', 'int'], moves: ['moves', 'int'], rooms: ['rooms_json', 'json'], raidTimes: ['raid_times_json', 'json'], lastCollectAt: ['last_collect_at', 'int'],
      lastSealAt: ['last_seal_at', 'int'], changes: ['changes', 'int'], patched: ['patched', 'bool'], log: ['log_json', 'json'], seen: ['seen', 'bool'], createdAt: ['created_at', 'int'],
    },
    index: ['player_id'],
  },
};

function column(name: string, kind: Kind, pk: boolean) {
  const c =
    kind === 'int'
      ? integer(name)
      : kind === 'bool'
        ? integer(name, { mode: 'boolean' })
        : kind === 'json'
          ? text(name, { mode: 'json' })
          : kind === 'blob64'
            ? blob(name, { mode: 'buffer' })
            : text(name);
  return pk ? c.primaryKey() : c;
}

export const tables = Object.fromEntries(
  Object.entries(spec).map(([key, s]) => [
    key,
    sqliteTable(
      s.table,
      Object.fromEntries(Object.entries(s.cols).map(([field, [col, kind]]) => [field, column(col, kind, field === 'id')])) as never,
    ),
  ]),
) as unknown as Record<keyof Repo, ReturnType<typeof sqliteTable>>;

/** `ALTER TABLE … ADD COLUMN` for spec columns an older database file doesn't have yet. */
export function addColumns(existing: (table: string) => string[]): string[] {
  const sqlType = (k: Kind) => (k === 'int' || k === 'bool' ? 'INTEGER' : k === 'blob64' ? 'BLOB' : 'TEXT');
  const out: string[] = [];
  for (const s of Object.values(spec)) {
    const have = new Set(existing(s.table));
    for (const [, [col, kind]] of Object.entries(s.cols)) if (!have.has(col)) out.push(`ALTER TABLE "${s.table}" ADD COLUMN "${col}" ${sqlType(kind)}`);
  }
  return out;
}

/** CREATE TABLE IF NOT EXISTS for every table (the hackathon's migration step). */
export function ddl(): string[] {
  const sqlType = (k: Kind) => (k === 'int' || k === 'bool' ? 'INTEGER' : k === 'blob64' ? 'BLOB' : 'TEXT');
  const out: string[] = [];
  for (const s of Object.values(spec)) {
    const cols = Object.entries(s.cols).map(([field, [col, kind]]) => `"${col}" ${sqlType(kind)}${field === 'id' ? ' PRIMARY KEY' : ''}`);
    out.push(`CREATE TABLE IF NOT EXISTS "${s.table}" (${cols.join(', ')})`);
    for (const ix of s.index ?? []) out.push(`CREATE INDEX IF NOT EXISTS "ix_${s.table}_${ix}" ON "${s.table}" ("${ix}")`);
  }
  return out;
}
