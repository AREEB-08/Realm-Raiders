import { Capacitor } from '@capacitor/core';
import type { HomeDTO, LobbyDTO, SessionDTO } from '@realm/shared';
import { RealmNative } from '../ui/lib/realmNative';
import { api } from './api';
import { config } from './config';

/**
 * Play with Friends (spec F9): find a host on this Wi-Fi and join its room.
 * The scan asks GET /health on port 8787 of every address in the phone's /24 (300 ms each,
 * many at once); a host running `pnpm dev:lan` answers with its name. The room code is never
 * part of /health, so joining always needs it.
 */
export const LAN_PORT = 8787;

export interface FoundHost {
  ip: string;
  base: string;
  hostName: string;
  players: number;
}

const PRIVATE = /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/;

export async function probeHost(base: string, ms = 300): Promise<FoundHost | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(`${base}/health`, { signal: ctrl.signal });
    if (!r.ok) return null;
    const h = (await r.json()) as { lan?: { hostName: string; players: number } | null };
    if (!h.lan) return null;
    return { ip: new URL(base).hostname, base, hostName: h.lan.hostName, players: h.lan.players };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** The /24 prefixes worth scanning: the phone's own Wi-Fi (native), the page's host, known servers. */
async function prefixes(): Promise<string[]> {
  const out = new Set<string>();
  if (Capacitor.isNativePlatform()) {
    try {
      const { ip } = await RealmNative.wifiIp();
      if (ip && PRIVATE.test(ip)) out.add(ip.split('.').slice(0, 3).join('.'));
    } catch {
      /* older APK without the method */
    }
  }
  if (PRIVATE.test(location.hostname)) out.add(location.hostname.split('.').slice(0, 3).join('.'));
  return [...out];
}

/** "Searching your Wi-Fi for a host…" — calls onFound as hosts answer; resolves when done. */
export async function scanWifi(onFound: (h: FoundHost) => void, signal?: AbortSignal): Promise<FoundHost[]> {
  const found = new Map<string, FoundHost>();
  const hit = (h: FoundHost | null) => {
    if (!h || found.has(h.base)) return;
    found.set(h.base, h);
    onFound(h);
  };
  // Servers this build already knows (the emulator's 10.0.2.2, localhost on a dev PC, a LAN IP).
  const known = [...new Set(config.apiUrls.map((u) => u.replace(/:\d+$/, `:${LAN_PORT}`)))];
  await Promise.all(known.map(async (b) => hit(await probeHost(b, 600))));
  for (const p of await prefixes()) {
    const ips = Array.from({ length: 254 }, (_, i) => `${p}.${i + 1}`);
    for (let i = 0; i < ips.length; i += 64) {
      if (signal?.aborted) break;
      await Promise.all(ips.slice(i, i + 64).map(async (ip) => hit(await probeHost(`http://${ip}:${LAN_PORT}`))));
    }
  }
  return [...found.values()];
}

/** Turn what the player typed ("192.168.1.12", "192.168.1.12:8787", a URL) into a base URL. */
export function hostBase(input: string) {
  const s = input.trim().replace(/\/+$/, '');
  if (/^https?:\/\//.test(s)) return s;
  return /:\d+$/.test(s) ? `http://${s}` : `http://${s}:${LAN_PORT}`;
}

/**
 * Join a room: talk to the host from now on, sign in with this phone's device id (the host keeps
 * one commander per phone), bring the General along, then enter the room with its code.
 */
export async function joinRoom(base: string, code: string, local: HomeDTO | null): Promise<LobbyDTO> {
  const host = await probeHost(base, 2500);
  if (!host) throw new Error('No Realm Raiders host answers at that address.');
  await api.enterLan({ base, room: code.toUpperCase(), hostName: host.hostName });
  try {
    const auth = await api.post<SessionDTO>('/auth/demo', { deviceId: await api.deviceId() });
    await api.setSession(auth.session, auth.playerId);
    const home = await api.get<HomeDTO>('/home');
    if (!home.general) {
      const g = local?.general;
      await api.put('/general', {
        name: g?.name ?? 'Commander',
        personality: g?.personality ?? 'bold',
        faction: g?.faction ?? 'thornmarch',
        appearance: g?.appearance ?? (await import('@realm/shared')).defaultAppearance('thornmarch'),
      });
    }
    const lobby = await api.post<LobbyDTO>('/lan/join', { code: code.toUpperCase() });
    api.connect();
    return lobby;
  } catch (e) {
    await api.leaveLan();
    throw e;
  }
}

export async function leaveRoom() {
  await api.post('/lan/leave').catch(() => {});
  return api.leaveLan();
}
