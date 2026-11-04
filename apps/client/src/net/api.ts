import { HttpError } from '@realm/core';
import type { ClientMsg, ServerMsg } from '@realm/shared';
import { prefs } from '../persist/prefs';
import { config, wsUrlFor } from './config';
import { localCore, startLocal } from './local';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export type BackendMode = 'remote' | 'local';
type Listener = (msg: ServerMsg | { t: string; d: unknown }) => void;

const SESSION_KEY = 'realm-raiders-session';
const MODE_KEY = 'realm-raiders-mode';
/** Play with Friends: the LAN host this phone joined ({ base, room }) and its own session there. */
const LAN_KEY = 'realm-raiders-lan';
const LAN_SESSION_KEY = 'realm-raiders-session-lan';
const DEVICE_KEY = 'realm-raiders-device';

export interface LanRoom {
  base: string;
  room: string;
  hostName: string;
}

/**
 * One request function for both backends (§9 net/api.ts): the HTTP server, or the same route
 * table running in-app. The UI never knows which one answered.
 */
class Api {
  mode: BackendMode = 'local';
  base = config.apiUrls[0] ?? 'http://localhost:8787';
  session: string | null = null;
  playerId: string | null = null;
  offlineSince: number | null = null;
  private socket: WebSocket | null = null;
  private subs = new Map<string, Set<Listener>>();
  private localUnsubs = new Map<string, () => void>();
  private retry = 0;
  /** Set while this phone plays in a friend's LAN room (remote mode on their laptop). */
  lan: LanRoom | null = null;

  private get sessionKey() {
    return this.lan ? LAN_SESSION_KEY : SESSION_KEY;
  }

  async init(): Promise<BackendMode> {
    // Back into the LAN room we were in, if its host still answers.
    const room = await prefs.get(LAN_KEY);
    if (room) {
      try {
        const lan = JSON.parse(room) as LanRoom;
        if (await this.reachable(lan.base)) {
          this.lan = lan;
          this.mode = 'remote';
          this.base = lan.base;
          this.session = await prefs.get(LAN_SESSION_KEY);
          return this.mode;
        }
      } catch {
        /* forget a broken entry */
      }
      await prefs.remove(LAN_KEY);
    }
    const saved = await prefs.get(MODE_KEY);
    const want = config.backend;
    const reachable = want === 'local' ? null : await this.probe();
    if (reachable) this.base = reachable;
    if (want === 'remote' || reachable) this.mode = 'remote';
    else this.mode = 'local';
    // A session belongs to one backend; drop it when the backend changes.
    if (saved && saved !== this.mode) await prefs.remove(SESSION_KEY);
    await prefs.set(MODE_KEY, this.mode);
    if (this.mode === 'local') await startLocal();
    this.session = await prefs.get(SESSION_KEY);
    return this.mode;
  }

  private async reachable(base: string, ms = 1500) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try {
      return (await fetch(`${base}/health`, { signal: ctrl.signal })).ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /** A stable id for this phone, so a LAN host keeps the same commander for it. */
  async deviceId() {
    let id = await prefs.get(DEVICE_KEY);
    if (!id) {
      id = `d-${Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      await prefs.set(DEVICE_KEY, id);
    }
    return id;
  }

  /** Play with Friends: talk to a friend's host from now on (this phone's own realm is kept). */
  async enterLan(room: LanRoom) {
    this.dropLive();
    this.lan = room;
    this.mode = 'remote';
    this.base = room.base;
    this.session = await prefs.get(LAN_SESSION_KEY);
    await prefs.set(LAN_KEY, JSON.stringify(room));
  }

  /** Leave the room: back to the realm on this phone (offline or the usual server). */
  async leaveLan() {
    this.dropLive();
    this.lan = null;
    await prefs.remove(LAN_KEY);
    this.mode = 'local';
    this.base = config.apiUrls[0] ?? 'http://localhost:8787';
    return this.init();
  }

  private dropLive() {
    this.socket?.close();
    this.socket = null;
    for (const off of this.localUnsubs.values()) off();
    this.localUnsubs.clear();
  }

  /** First server (of VITE_API_URL's list) that answers /health within 1.8 s, else null. */
  private async probe(): Promise<string | null> {
    const tries = config.apiUrls.map(async (base) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 1800);
      try {
        const r = await fetch(`${base}/health`, { signal: ctrl.signal });
        return r.ok ? base : null;
      } catch {
        return null;
      } finally {
        clearTimeout(t);
      }
    });
    for (const r of await Promise.all(tries)) if (r) return r;
    return null;
  }

  async setSession(session: string | null, playerId: string | null) {
    this.session = session;
    this.playerId = playerId;
    if (session) await prefs.set(this.sessionKey, session);
    else await prefs.remove(this.sessionKey);
    this.reconnect();
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    if (this.mode === 'local') {
      const core = localCore() ?? (await startLocal());
      try {
        return (await core.handle(method, path, body ?? {}, this.session)) as T;
      } catch (e) {
        if (e instanceof HttpError) throw new ApiError(e.status, e.message, e.details);
        throw new ApiError(500, (e as Error).message);
      }
    }
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: {
          ...(body !== undefined && method !== 'GET' ? { 'content-type': 'application/json' } : {}),
          ...(this.session ? { authorization: `Bearer ${this.session}` } : {}),
        },
        body: body !== undefined && method !== 'GET' ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      this.offlineSince ??= Date.now();
      throw new ApiError(0, 'The courier is delayed — no connection to the server.');
    }
    this.offlineSince = null;
    const json = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
    if (!res.ok) throw new ApiError(res.status, json.error ?? `HTTP ${res.status}`, json.details);
    return json as T;
  }

  /**
   * Server asset URLs (portraits) are built from the server's PUBLIC_BASE_URL, which may say
   * localhost; on a phone that is the phone itself. Re-home them onto the server we reached.
   */
  asset(url: string | null | undefined): string | null {
    if (!url) return null;
    if (this.mode !== 'remote' || url.startsWith('data:')) return url;
    try {
      const u = new URL(url);
      if (u.pathname.startsWith('/portraits/') || u.pathname.startsWith('/badges/')) return `${this.base}${u.pathname}${u.search}`;
    } catch {
      /* relative or odd URL: leave it */
    }
    return url;
  }

  get = <T>(path: string) => this.request<T>('GET', path);
  post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, body ?? {});
  put = <T>(path: string, body?: unknown) => this.request<T>('PUT', path, body ?? {});

  // ------------------------------------------------------------------- live ---

  subscribe(channel: string, cb: Listener): () => void {
    let set = this.subs.get(channel);
    if (!set) this.subs.set(channel, (set = new Set()));
    set.add(cb);
    if (this.mode === 'local') {
      if (!this.localUnsubs.has(channel)) {
        const core = localCore();
        const off = core?.ctx.bus.subscribe(channel, (m) => this.deliver(channel, m)) ?? (() => {});
        this.localUnsubs.set(channel, off);
      }
    } else {
      this.ensureSocket();
      this.sendRaw({ t: 'sub', d: { ch: channel } });
    }
    return () => {
      set!.delete(cb);
      if (set!.size) return;
      this.subs.delete(channel);
      if (this.mode === 'local') {
        this.localUnsubs.get(channel)?.();
        this.localUnsubs.delete(channel);
      } else this.sendRaw({ t: 'unsub', d: { ch: channel } });
    };
  }

  /** Raid a friend: stream the actions applied so far (the host relays them to the defender). */
  sendLive(battleId: string, tick: number, actions: unknown[]) {
    if (this.mode === 'remote') this.sendRaw({ t: 'live', d: { battleId, tick, actions } });
  }

  /** Live Duel: my stars and % for the opponent's mini-bar. */
  sendDuel(duelId: string, stars: number, pct: number) {
    if (this.mode === 'remote') this.sendRaw({ t: 'duel', d: { duelId, stars, pct } });
  }

  /** Keep a socket open (presence in a LAN room) even before any channel is joined. */
  connect() {
    this.ensureSocket();
  }

  private deliver(channel: string, msg: ServerMsg | { t: string; d: unknown }) {
    for (const cb of this.subs.get(channel) ?? []) cb(msg);
  }

  private sendRaw(msg: ClientMsg) {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(msg));
  }

  private ensureSocket() {
    if (this.mode !== 'remote' || !this.session) return;
    if (this.socket && this.socket.readyState <= 1) return;
    const ws = new WebSocket(`${wsUrlFor(this.base)}?token=${encodeURIComponent(this.session)}`);
    this.socket = ws;
    ws.onopen = () => {
      this.retry = 0;
      for (const ch of this.subs.keys()) this.sendRaw({ t: 'sub', d: { ch } });
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as ServerMsg & { ch?: string; d: { planId?: string; warRoomId?: string } };
        // Newer hosts name the channel; route exactly.
        if (msg.ch) {
          if (this.subs.has(msg.ch)) this.deliver(msg.ch, msg);
          return;
        }
        // Older hosts: route by type to every channel that cares (sim/warroom → warroom:*).
        for (const ch of this.subs.keys()) {
          if ((msg.t === 'sim' || msg.t === 'warroom') && ch.startsWith('warroom:')) this.deliver(ch, msg);
          else if (msg.t === 'tx' && ch.startsWith('chain:')) this.deliver(ch, msg);
        }
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      if (this.socket === ws) this.socket = null;
      if (!this.subs.size && !this.lan) return;
      const delay = Math.min(8000, 500 * 2 ** this.retry++);
      setTimeout(() => this.ensureSocket(), delay);
    };
  }

  private reconnect() {
    this.socket?.close();
    this.socket = null;
    if (this.subs.size) this.ensureSocket();
  }
}

export const api = new Api();
