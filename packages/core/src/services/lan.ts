import { fromHex, keccak, utf8, type Action } from '@realm/battle-engine';
import { GEM_REWARDS } from '@realm/game-data';
import {
  EMOTES,
  channels,
  randomHex32,
  type DuelDTO,
  type DuelSideDTO,
  type EmoteId,
  type Hex,
  type LobbyDTO,
  type LobbyStatus,
  type SpectateDTO,
  type TxRef,
} from '@realm/shared';
import type { Ctx } from '../ctx';
import { HttpError, type BattleDoc } from '../types';
import { runningSession } from './auto';
import { loadPlayer, pushEvent, uid } from './common';
import { grantGems } from './gems';
import { friendIsland, islandTarget } from './targets';
import { createWarRoom } from './warroom';

/**
 * Play with Friends on the same Wi-Fi (spec F9). One laptop runs the server with a room code;
 * phones join the room. Presence lives in memory (it is a live room); duels are stored in `kv`.
 *
 * - Lobby: who is here, their status, READY and emotes, pushed on the `lobby` channel.
 * - Raid a friend: the friend's sealed base is a target (see targets.ts); the attacker streams
 *   the actions it applied and the defender's phone re-simulates them ~0.5 s behind (the engine
 *   is deterministic, so the replay IS the battle).
 * - Live Duel: one shared seed locked by commit-reveal, both attack each other's base inside a
 *   3-minute window, both replays re-simulated here, the result recorded on RealmDuels.
 */
export const DUEL_WINDOW_MS = 180_000;
export const RECONNECT_MS = 20_000;
export const NO_HOST = 'Play with Friends needs a host on your Wi-Fi.';
export const DUEL_RENOWN = 20;
/** A commander who has been offline this long leaves the room listing (they can join again). */
export const AWAY_DROP_MS = 10 * 60_000;

interface Member {
  playerId: string;
  name: string;
  ready: boolean;
  status: LobbyStatus;
  sockets: number;
  lastSeen: number;
}

interface DuelSide {
  playerId: string;
  name: string;
  address: Hex;
  warRoomId: string | null;
  battleId: string | null;
  stars: number | null;
  bp: number | null;
  ticks: number | null;
  replayHash: Hex | null;
  live: { stars: number; pct: number } | null;
}

export interface DuelDoc {
  id: string;
  chainId: Hex;
  a: DuelSide;
  b: DuelSide;
  status: DuelDTO['status'];
  seed: Hex | null;
  seedTx: TxRef | null;
  startsAt: number;
  endsAt: number;
  winner: string | null;
  decidedBy: DuelDTO['decidedBy'];
  resultTx: TxRef | null;
  createdAt: number;
}

const hubs = new WeakMap<object, LanHub>();
/** The LAN room of this realm (null when the realm runs offline on a phone). */
export const lanOf = (ctx: Ctx) => {
  const h = hubs.get(ctx.repo) ?? null;
  return h && h.enabled ? h : null;
};

export class LanHub {
  private members = new Map<string, Member>();
  private duels = new Map<string, DuelDoc>();
  private liveLogs = new Map<string, { attacker: string; defender: string; actions: Action[]; tick: number; ended: boolean }>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ctx: Ctx) {
    hubs.set(ctx.repo, this);
  }

  get enabled() {
    return !!this.ctx.cfg.lan;
  }

  start() {
    if (!this.enabled) return;
    this.timer = setInterval(() => void this.tick(), 1000);
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private need() {
    if (!this.enabled) throw new HttpError(409, NO_HOST);
    return this.ctx.cfg.lan!;
  }

  private member(playerId: string) {
    const m = this.members.get(playerId);
    if (!m) throw new HttpError(403, 'Join the room first.');
    return m;
  }

  memberIds() {
    return [...this.members.keys()];
  }

  // -------------------------------------------------------------------- lobby ---

  async join(playerId: string, code: string) {
    const lan = this.need();
    if (code.trim().toUpperCase() !== lan.room) throw new HttpError(403, 'That room code is not right — check the host screen.');
    const { general } = await loadPlayer(this.ctx, playerId);
    const m = this.members.get(playerId);
    this.members.set(playerId, {
      playerId,
      name: general?.name ?? 'A commander',
      ready: m?.ready ?? false,
      status: m?.status ?? 'island',
      sockets: m?.sockets ?? 0,
      lastSeen: this.ctx.now(),
    });
    await this.pushLobby();
    return this.lobby(playerId);
  }

  async leave(playerId: string) {
    this.members.delete(playerId);
    await this.pushLobby();
  }

  async lobby(playerId: string): Promise<LobbyDTO> {
    const lan = this.need();
    this.member(playerId);
    return { room: lan.room, hostName: lan.hostName, me: playerId, players: await this.players() };
  }

  private async players() {
    const out: LobbyDTO['players'] = [];
    for (const m of this.members.values()) {
      const { player, base, res, general } = await loadPlayer(this.ctx, m.playerId);
      const seal = await this.ctx.chain.sealOf(player.address);
      const auto = await runningSession(this.ctx, m.playerId);
      out.push({
        playerId: m.playerId,
        name: general?.name ?? m.name,
        status: auto ? 'auto' : m.status,
        ready: m.ready,
        online: m.sockets > 0,
        sealed: !!base.sealedHash && !!seal && seal.baseHash.toLowerCase() === base.sealedHash.toLowerCase(),
        renown: res.renown,
        portraitUrl: general?.portrait ?? null,
      });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async pushLobby() {
    if (!this.enabled) return;
    this.ctx.bus.publish(channels.lobby(), { t: 'lobby', d: { players: await this.players() } });
  }

  async setReady(playerId: string, ready: boolean) {
    this.member(playerId).ready = ready;
    await this.pushLobby();
    return { ready };
  }

  emote(playerId: string, emote: EmoteId) {
    const m = this.member(playerId);
    this.ctx.bus.publish(channels.lobby(), { t: 'emote', d: { from: playerId, name: m.name, emote, text: EMOTES[emote], at: this.ctx.now() } });
    return { ok: true };
  }

  /** A WebSocket opened / closed for this commander (presence + the 20 s reconnect window). */
  online(playerId: string) {
    const m = this.members.get(playerId);
    if (!m) return;
    m.sockets++;
    m.lastSeen = this.ctx.now();
    for (const d of this.duels.values())
      if (d.status === 'live' && (d.a.playerId === playerId || d.b.playerId === playerId))
        this.ctx.bus.publish(channels.duel(d.id), { t: 'duel-back', d: { playerId, name: m.name } });
    void this.pushLobby();
  }

  offline(playerId: string) {
    const m = this.members.get(playerId);
    if (!m) return;
    m.sockets = Math.max(0, m.sockets - 1);
    m.lastSeen = this.ctx.now();
    if (m.sockets === 0)
      for (const d of this.duels.values())
        if (d.status === 'live' && (d.a.playerId === playerId || d.b.playerId === playerId))
          this.ctx.bus.publish(channels.duel(d.id), { t: 'duel-wait', d: { playerId, name: m.name, until: m.lastSeen + RECONNECT_MS } });
    void this.pushLobby();
  }

  private setStatus(playerId: string, status: LobbyStatus) {
    const m = this.members.get(playerId);
    if (!m || m.status === status) return;
    m.status = status;
    void this.pushLobby();
  }

  // --------------------------------------------------------- raid a friend ---

  /** A raid on a friend was committed: alert them and open the live stream. */
  raidStarted(b: BattleDoc) {
    if (!b.islandId?.startsWith('p:')) return;
    this.liveLogs.set(b.id, { attacker: b.attackerId, defender: b.defenderId, actions: [], tick: 0, ended: false });
    this.setStatus(b.attackerId, b.kind === 'duel' ? 'duel' : 'raiding');
    if (b.kind === 'raid')
      this.ctx.bus.publish(channels.player(b.defenderId), { t: 'raid-alert', d: { battleId: b.id, attacker: b.attackerName, text: `${b.attackerName} is raiding you!` } });
  }

  /** The attacker's phone streams the actions it applied (every ~0.5 s). */
  live(playerId: string, battleId: string, tick: number, actions: unknown[]) {
    const log = this.liveLogs.get(battleId);
    if (!log || log.attacker !== playerId || log.ended) return;
    const fresh = (actions as Action[]).filter((a) => a && typeof a.t === 'number' && a.t >= log.tick).slice(0, 200);
    log.actions.push(...fresh);
    log.tick = Math.max(log.tick, Math.floor(Number(tick) || 0));
    this.ctx.bus.publish(channels.battle(battleId), { t: 'live', d: { tick: log.tick, actions: fresh } });
  }

  raidEnded(b: BattleDoc) {
    const log = this.liveLogs.get(b.id);
    if (log) log.ended = true;
    this.setStatus(b.attackerId, 'island');
    this.ctx.bus.publish(channels.battle(b.id), { t: 'live-end', d: { stars: b.stars, destructionPct: (b.destructionBp ?? 0) / 100, verified: b.status === 'recorded' || b.status === 'verified' } });
  }

  async spectate(playerId: string, battleId: string): Promise<SpectateDTO> {
    this.need();
    const b = await this.ctx.repo.battles.get(battleId);
    const log = this.liveLogs.get(battleId);
    if (!b || !log) throw new HttpError(404, 'That raid is not live.');
    if (b.defenderId !== playerId && !this.members.has(playerId)) throw new HttpError(403, 'Only the room can watch.');
    return {
      battleId,
      attacker: b.attackerName,
      defender: b.defenderName,
      input: { engineVersion: b.engineVersion ?? 1, seed: b.seed, base: b.base, army: b.army },
      actions: log.actions,
      tick: log.tick,
      ended: log.ended,
    };
  }

  // -------------------------------------------------------------- live duel ---

  private side(playerId: string, name: string, address: Hex): DuelSide {
    return { playerId, name, address, warRoomId: null, battleId: null, stars: null, bp: null, ticks: null, replayHash: null, live: null };
  }

  private async save(d: DuelDoc) {
    this.duels.set(d.id, d);
    await this.ctx.repo.kv.put({ id: `duel:${d.id}`, value: d });
  }

  async duel(id: string): Promise<DuelDoc> {
    const d = this.duels.get(id) ?? ((await this.ctx.repo.kv.get(`duel:${id}`))?.value as DuelDoc | undefined);
    if (!d) throw new HttpError(404, 'no such duel');
    return d;
  }

  dto(d: DuelDoc): DuelDTO {
    const s = (x: DuelSide): DuelSideDTO => ({
      playerId: x.playerId,
      name: x.name,
      warRoomId: x.warRoomId,
      battleId: x.battleId,
      stars: x.stars,
      destructionPct: x.bp === null ? null : x.bp / 100,
      seconds: x.ticks === null ? null : Math.round(x.ticks / 20),
      live: x.live,
      online: (this.members.get(x.playerId)?.sockets ?? 0) > 0,
    });
    return { duelId: d.id, status: d.status, a: s(d.a), b: s(d.b), seedTx: d.seedTx, startsAt: d.startsAt, endsAt: d.endsAt, winner: d.winner, decidedBy: d.decidedBy, resultTx: d.resultTx };
  }

  async invite(from: string, to: string) {
    this.need();
    this.member(from);
    this.member(to);
    if (from === to) throw new HttpError(400, 'Pick a friend, not yourself.');
    for (const id of [from, to])
      if (await runningSession(this.ctx, id)) throw new HttpError(409, 'A commander in Auto Mode cannot duel.');
    const pa = await loadPlayer(this.ctx, from);
    const pb = await loadPlayer(this.ctx, to);
    const d: DuelDoc = {
      id: uid('d_'),
      chainId: '0x' as Hex,
      a: this.side(from, pa.general?.name ?? 'Commander', pa.player.address),
      b: this.side(to, pb.general?.name ?? 'Commander', pb.player.address),
      status: 'invited',
      seed: null,
      seedTx: null,
      startsAt: 0,
      endsAt: 0,
      winner: null,
      decidedBy: null,
      resultTx: null,
      createdAt: this.ctx.now(),
    };
    d.chainId = keccak(utf8(`duel:${d.id}`));
    await this.save(d);
    this.ctx.bus.publish(channels.player(to), { t: 'duel-invite', d: { duelId: d.id, from: d.a.name, text: `${d.a.name} challenges you to a Live Duel!` } });
    return this.dto(d);
  }

  async decline(playerId: string, id: string) {
    const d = await this.duel(id);
    if (d.b.playerId !== playerId || d.status !== 'invited') throw new HttpError(409, 'Nothing to decline.');
    d.status = 'declined';
    await this.save(d);
    this.ctx.bus.publish(channels.duel(d.id), { t: 'duel', d: this.dto(d) });
    this.ctx.bus.publish(channels.player(d.a.playerId), { t: 'duel-declined', d: { duelId: d.id, name: d.b.name } });
    return this.dto(d);
  }

  /** Both bases must be sealed; then ONE seed is locked by commit-reveal and the 3 minutes start. */
  async accept(playerId: string, id: string) {
    const d = await this.duel(id);
    if (d.b.playerId !== playerId) throw new HttpError(403, 'This challenge is not for you.');
    if (d.status !== 'invited') return this.dto(d);
    for (const s of [d.a, d.b]) {
      const isle = await friendIsland(this.ctx, s.playerId, 1);
      const t = isle ? await islandTarget(this.ctx, isle, []) : null;
      if (!t?.sealed) throw new HttpError(409, `${s.name} must seal their base in the Ledger first.`);
    }
    const defender = await loadPlayer(this.ctx, d.b.playerId);
    const secret = randomHex32();
    await this.ctx.chain.commitBattle({
      battleId: d.chainId,
      attacker: d.a.address,
      defender: d.b.address,
      defenderBaseHash: defender.base.sealedHash!,
      secretHash: keccak(fromHex(secret)),
      attackerNonce: randomHex32(),
    });
    const { tx, seed } = await this.ctx.chain.revealSeed(d.chainId, secret);
    d.seed = seed;
    d.seedTx = tx;
    d.status = 'live';
    d.startsAt = this.ctx.now();
    d.endsAt = d.startsAt + DUEL_WINDOW_MS;
    // Each commander's War Room against the other's base (150 practice raids, on the host).
    d.a.warRoomId = (await createWarRoom(this.ctx, d.a.playerId, `p:${d.b.playerId}`)).warRoomId;
    d.b.warRoomId = (await createWarRoom(this.ctx, d.b.playerId, `p:${d.a.playerId}`)).warRoomId;
    await this.save(d);
    this.setStatus(d.a.playerId, 'duel');
    this.setStatus(d.b.playerId, 'duel');
    const msg = { t: 'duel-start', d: this.dto(d) };
    this.ctx.bus.publish(channels.player(d.a.playerId), msg);
    this.ctx.bus.publish(channels.player(d.b.playerId), msg);
    this.ctx.bus.publish(channels.duel(d.id), msg);
    return this.dto(d);
  }

  /** The seed and the opponent for a duel commit (battle.ts). */
  async duelCommit(playerId: string, id: string) {
    const d = await this.duel(id);
    if (d.status !== 'live' || !d.seed || !d.seedTx) throw new HttpError(409, 'The duel is not live.');
    if (this.ctx.now() > d.endsAt) throw new HttpError(409, 'The 3 minutes are over.');
    const me = d.a.playerId === playerId ? d.a : d.b.playerId === playerId ? d.b : null;
    if (!me) throw new HttpError(403, 'You are not in this duel.');
    if (me.battleId) throw new HttpError(409, 'You already attacked in this duel.');
    const foe = me === d.a ? d.b : d.a;
    return { duel: d, me, foe, seed: d.seed, seedTx: d.seedTx };
  }

  async duelCommitted(id: string, playerId: string, battleId: string) {
    const d = await this.duel(id);
    const me = d.a.playerId === playerId ? d.a : d.b;
    me.battleId = battleId;
    await this.save(d);
    this.ctx.bus.publish(channels.duel(d.id), { t: 'duel', d: this.dto(d) });
  }

  /** WS: the duel mini-bar ("You 2★ 64% · Ayaan 1★ 48%"). */
  progress(playerId: string, id: string, stars: number, pct: number) {
    const d = this.duels.get(id);
    if (!d || d.status !== 'live') return;
    const me = d.a.playerId === playerId ? d.a : d.b.playerId === playerId ? d.b : null;
    if (!me) return;
    me.live = { stars: Math.max(0, Math.min(3, Math.floor(stars))), pct: Math.max(0, Math.min(100, Math.round(pct))) };
    this.ctx.bus.publish(channels.duel(d.id), { t: 'duel-progress', d: { playerId, ...me.live } });
  }

  /** A duel replay was re-simulated and verified (battle.ts). */
  async duelSubmitted(id: string, playerId: string, r: { stars: number; bp: number; ticks: number; replayHash: Hex }) {
    const d = await this.duel(id);
    const me = d.a.playerId === playerId ? d.a : d.b;
    Object.assign(me, { stars: r.stars, bp: r.bp, ticks: r.ticks, replayHash: r.replayHash, live: { stars: r.stars, pct: Math.round(r.bp / 100) } });
    await this.save(d);
    this.ctx.bus.publish(channels.duel(d.id), { t: 'duel', d: this.dto(d) });
    if (d.a.stars !== null && d.b.stars !== null) await this.decide(d, 'replays');
    return this.dto(await this.duel(id));
  }

  /** Winner = more stars, then higher %, then faster time. A missing replay counts as 0★. */
  async decide(d: DuelDoc, by: NonNullable<DuelDoc['decidedBy']>) {
    if (d.status === 'decided') return;
    d.status = 'decided';
    d.decidedBy = by;
    const score = (s: DuelSide) => [s.stars ?? -1, s.bp ?? -1, -(s.ticks ?? 99_999)];
    const [sa, sb] = [score(d.a), score(d.b)];
    let w: string | null = 'draw';
    for (let i = 0; i < 3; i++)
      if (sa[i] !== sb[i]) {
        w = sa[i]! > sb[i]! ? d.a.playerId : d.b.playerId;
        break;
      }
    d.winner = w;
    const ZERO = `0x${'0'.repeat(64)}` as Hex;
    try {
      d.resultTx = await this.ctx.chain.recordDuel({
        duelId: d.chainId,
        playerA: d.a.address,
        playerB: d.b.address,
        starsA: d.a.stars ?? 0,
        starsB: d.b.stars ?? 0,
        pctA: d.a.bp ?? 0,
        pctB: d.b.bp ?? 0,
        replayHashA: d.a.replayHash ?? ZERO,
        replayHashB: d.b.replayHash ?? ZERO,
      });
    } catch (e) {
      this.ctx.log('recordDuel failed', (e as Error).message);
    }
    for (const s of [d.a, d.b]) {
      const { res } = await loadPlayer(this.ctx, s.playerId);
      const won = d.winner === s.playerId;
      if (won) {
        res.renown += DUEL_RENOWN;
        await grantGems(this.ctx, res, GEM_REWARDS.duelWin, 'duel', 'Won a friend duel');
      }
      const foe = s === d.a ? d.b : d.a;
      pushEvent(
        res,
        {
          icon: 'raid',
          title: won ? `Duel won against ${foe.name}` : d.winner === 'draw' ? `Duel drawn with ${foe.name}` : `Duel lost to ${foe.name}`,
          body: `You ${s.stars ?? 0}★ ${Math.round((s.bp ?? 0) / 100)}% vs ${foe.name} ${foe.stars ?? 0}★ ${Math.round((foe.bp ?? 0) / 100)}%${won ? ` · +${GEM_REWARDS.duelWin} Gems · +${DUEL_RENOWN} Renown` : ''}`,
          at: this.ctx.now(),
          tx: d.resultTx,
        },
        this.ctx.now(),
      );
      await this.ctx.repo.resources.put(res);
      this.setStatus(s.playerId, 'island');
    }
    await this.save(d);
    const msg = { t: 'duel-result', d: this.dto(d) };
    this.ctx.bus.publish(channels.duel(d.id), msg);
    this.ctx.bus.publish(channels.player(d.a.playerId), msg);
    this.ctx.bus.publish(channels.player(d.b.playerId), msg);
  }

  /** Every second: close duels whose window (plus the reconnect grace) is over, or whose opponent never came back. */
  async tick() {
    const now = this.ctx.now();
    let dropped = false;
    for (const m of [...this.members.values()])
      if (m.sockets === 0 && now - m.lastSeen > AWAY_DROP_MS && ![...this.duels.values()].some((d) => d.status === 'live' && (d.a.playerId === m.playerId || d.b.playerId === m.playerId))) {
        this.members.delete(m.playerId);
        dropped = true;
      }
    if (dropped) await this.pushLobby();
    for (const d of this.duels.values()) {
      if (d.status === 'invited' && now - d.createdAt > 120_000) {
        d.status = 'declined';
        await this.save(d);
        continue;
      }
      if (d.status !== 'live') continue;
      if (now > d.endsAt + RECONNECT_MS) {
        await this.decide(d, 'timeout');
        continue;
      }
      // One side is done and the other has been gone for 20 s: decide by the replays received.
      for (const [me, foe] of [
        [d.a, d.b],
        [d.b, d.a],
      ] as const) {
        const m = this.members.get(foe.playerId);
        if (me.stars !== null && foe.stars === null && m && m.sockets === 0 && now - m.lastSeen > RECONNECT_MS) {
          await this.decide(d, 'disconnect');
          break;
        }
      }
    }
  }
}
