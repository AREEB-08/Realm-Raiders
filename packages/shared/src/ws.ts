import type { PlanStats } from './api';

/** WebSocket envelope (§16.4): `{t, d}`; channels are joined with `{t:'sub', d:{ch}}`. */
export type ClientMsg =
  | { t: 'sub'; d: { ch: string } }
  | { t: 'unsub'; d: { ch: string } }
  /** Raid a friend: the attacker streams the actions it applied, so the defender can watch live. */
  | { t: 'live'; d: { battleId: string; tick: number; actions: unknown[] } }
  /** Live Duel: my stars and % right now (every 500 ms) for the opponent's mini-bar. */
  | { t: 'duel'; d: { duelId: string; stars: number; pct: number } }
  | { t: 'ping'; d: Record<string, never> };


export type ServerMsg =
  | { t: 'sim'; d: { planId: string; done: number; of: number; stats?: PlanStats } }
  | { t: 'tx'; d: { kind: string; hash: string; status: 'pending' | 'confirmed' | 'failed'; url: string | null } }
  | { t: 'warroom'; d: unknown }
  | { t: 'hello'; d: { playerId: string } }
  | { t: 'pong'; d: Record<string, never> }
  | { t: 'error'; d: { message: string } };

export const channels = {
  warroom: (id: string) => `warroom:${id}`,
  chain: (playerId: string) => `chain:${playerId}`,
  /** LAN room: who is here, READY, emotes. */
  lobby: () => 'lobby',
  /** Personal alerts: "Ayaan is raiding you!", duel invites (only the player may join it). */
  player: (playerId: string) => `player:${playerId}`,
  duel: (id: string) => `duel:${id}`,
  /** A live friend raid's action stream. */
  battle: (id: string) => `battle:${id}`,
};
