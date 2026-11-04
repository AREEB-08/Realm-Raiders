import { networkInterfaces } from 'node:os';
import QR from 'qrcode';

/** Private IPv4 addresses of this machine, Wi-Fi/Ethernet first (192.168 → 10 → 172.16–31). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) out.push(`${a.address}|${name}`);
    }
  }
  const rank = (ip: string) => (ip.startsWith('192.168') ? 0 : ip.startsWith('10.') ? 1 : 2);
  const virtual = (n: string) => /vEthernet|VirtualBox|VMware|WSL|Hyper-V|docker|br-|vboxnet/i.test(n);
  return out
    .sort((a, b) => Number(virtual(a.split('|')[1]!)) - Number(virtual(b.split('|')[1]!)) || rank(a) - rank(b))
    .map((x) => x.split('|')[0]!);
}

export const randomRoom = () => {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O: easy to read aloud
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => letters[b % letters.length]).join('');
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The host page at /lan: big room code, the address to type, a QR of this page, how to join. */
export async function lanPage(lan: { room: string; hostName: string }, origin: string) {
  const host = origin.replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  const svg = await QR.toString(`${origin}/lan`, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#1c140c', light: '#f6e7c8' } });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Realm Raiders · Room ${esc(lan.room)}</title>
<style>
:root{color-scheme:light dark;--bg:#14231a;--card:#f6e7c8;--ink:#1c140c;--muted:#6b5a40;--gold:#f2b632}
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% 0,#2d4a33,var(--bg));color:#fff;font:16px/1.45 system-ui,sans-serif;display:grid;place-items:center;padding:16px}
main{max-width:720px;width:100%;display:grid;gap:14px;grid-template-columns:minmax(0,1fr) 220px}
@media(max-width:620px){main{grid-template-columns:1fr}}
.card{background:var(--card);color:var(--ink);border:3px solid #000;border-radius:16px;padding:16px 18px;box-shadow:0 4px 0 rgba(0,0,0,.4)}
h1{margin:0 0 4px;font-size:22px}.code{font-size:56px;font-weight:900;letter-spacing:.18em;color:#7a2a9b;line-height:1}
.ip{font:700 22px ui-monospace,monospace}.muted{color:var(--muted);font-size:14px}ol{margin:8px 0 0;padding-left:20px}
.qr svg{width:100%;height:auto;display:block}
</style></head><body><main>
<section class="card">
<h1>Play with Friends — Same Wi-Fi, same realm.</h1>
<div class="muted">Host: ${esc(lan.hostName)}</div>
<p style="margin:12px 0 4px">Room code</p><div class="code">${esc(lan.room)}</div>
<p style="margin:12px 0 4px">Host address</p><div class="ip">${esc(host)}</div>
<ol>
<li>Join the same Wi-Fi as this laptop.</li>
<li>Open Realm Raiders → <b>Play with Friends</b>. The app searches your Wi-Fi and finds this host.</li>
<li>Or tap <b>Enter host address</b>, type <b>${esc(host)}</b> and the room code <b>${esc(lan.room)}</b>, then <b>CONNECT</b>.</li>
</ol>
</section>
<section class="card qr" aria-label="QR code of this page">${svg}<div class="muted" style="text-align:center;margin-top:6px">Scan to open this page</div></section>
</main></body></html>`;
}
