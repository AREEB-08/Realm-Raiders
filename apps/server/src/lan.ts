/**
 * `pnpm dev:lan` — host Play with Friends on this laptop (spec F9).
 * Binds 0.0.0.0:8787, picks a 4-letter room code (or LAN_ROOM), prints the LAN address, the
 * code and an ASCII QR of http://<lan-ip>:8787/lan, then starts the normal server.
 */
import { hostname, userInfo } from 'node:os';
import QR from 'qrcode';
import { lanAddresses, randomRoom } from './lan-page';

const ips = lanAddresses();
const ip = ips[0] ?? '127.0.0.1';
const port = process.env.PORT ?? '8787';
process.env.HOST = '0.0.0.0';
process.env.LAN_ROOM = (process.env.LAN_ROOM ?? randomRoom()).toUpperCase();
process.env.LAN_NAME ??= (() => {
  try {
    return `${userInfo().username}'s laptop`;
  } catch {
    return hostname();
  }
})();
process.env.PUBLIC_BASE_URL ??= `http://${ip}:${port}`;

const page = `http://${ip}:${port}/lan`;
const qr = await QR.toString(page, { type: 'terminal', small: true });
console.log(`
  ⚔  Realm Raiders — Play with Friends
  ─────────────────────────────────────
  Host      ${process.env.LAN_NAME}
  Address   ${ip}:${port}${ips.length > 1 ? `   (also ${ips.slice(1).join(', ')})` : ''}
  Room code ${process.env.LAN_ROOM}
  Page      ${page}

  On each phone (same Wi-Fi): Play with Friends → JOIN, or Enter host address → ${ip} + ${process.env.LAN_ROOM}
${qr}`);

await import('./index');
