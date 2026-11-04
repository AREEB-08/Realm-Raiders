import type { Bus } from '@realm/core';
import type { ClientMsg, ServerMsg } from '@realm/shared';

interface Socket {
  send(data: string): void;
  readyState: number;
}

/**
 * WebSocket hub (§16.4): `{t, d}` JSON messages, channels joined with `{t:'sub'}`. It is also
 * the core's Bus, so services publish to channels without knowing about sockets.
 */
export class WsHub implements Bus {
  private channels = new Map<string, Set<Socket>>();
  private local = new Map<string, Set<(msg: ServerMsg | { t: string; d: unknown }) => void>>();
  private bySocket = new Map<Socket, Set<string>>();

  publish(channel: string, msg: ServerMsg | { t: string; d: unknown }) {
    // The channel rides along so a phone can route frames exactly (lobby, duel:…, battle:…).
    const data = JSON.stringify({ ...msg, ch: channel });
    for (const s of this.channels.get(channel) ?? []) if (s.readyState === 1) s.send(data);
    for (const cb of this.local.get(channel) ?? []) cb(msg);
  }

  subscribe(channel: string, cb: (msg: ServerMsg | { t: string; d: unknown }) => void) {
    let set = this.local.get(channel);
    if (!set) this.local.set(channel, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  attach(socket: Socket) {
    this.bySocket.set(socket, new Set());
  }

  join(socket: Socket, channel: string) {
    let set = this.channels.get(channel);
    if (!set) this.channels.set(channel, (set = new Set()));
    set.add(socket);
    this.bySocket.get(socket)?.add(channel);
  }

  leave(socket: Socket, channel: string) {
    this.channels.get(channel)?.delete(socket);
    this.bySocket.get(socket)?.delete(channel);
  }

  detach(socket: Socket) {
    for (const ch of this.bySocket.get(socket) ?? []) this.channels.get(ch)?.delete(socket);
    this.bySocket.delete(socket);
  }

  get connections() {
    return this.bySocket.size;
  }
}

export function parseClientMsg(raw: string): ClientMsg | null {
  try {
    const m = JSON.parse(raw) as ClientMsg;
    if (!m || typeof m.t !== 'string') return null;
    return m;
  } catch {
    return null;
  }
}
