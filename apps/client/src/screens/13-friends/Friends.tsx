import { useEffect, useRef, useState } from 'react';
import { Laptop, Search, Wifi } from 'lucide-react';
import { joinRoom, scanWifi, hostBase, type FoundHost } from '../../net/lan';
import { useStore } from '../../state';
import { Header, Spinner } from '../../ui/components';
import { Modal } from '../../ui/hud';
import { sfx } from '../../audio/sfx';

/** 13 — Play with Friends: find a host on this Wi-Fi (or type its address) and join its room (spec F9). */
export function Friends() {
  const { home, back, refreshHome, replace, fail, toast } = useStore();
  const [found, setFound] = useState<FoundHost[]>([]);
  const [scanning, setScanning] = useState(true);
  const [pick, setPick] = useState<FoundHost | null>(null);
  const [ip, setIp] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const scan = useRef<AbortController | null>(null);

  const search = () => {
    scan.current?.abort();
    const ctrl = new AbortController();
    scan.current = ctrl;
    setFound([]);
    setScanning(true);
    void scanWifi((h) => setFound((x) => [...x, h]), ctrl.signal).finally(() => !ctrl.signal.aborted && setScanning(false));
  };
  useEffect(() => {
    search();
    return () => scan.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (base: string) => {
    if (!/^[A-Za-z]{4}$/.test(code.trim())) return toast('Type the 4-letter room code from the host screen.', 'bad');
    setBusy(true);
    try {
      const lobby = await joinRoom(base, code.trim(), home);
      sfx.play('seal');
      toast(`Joined room ${lobby.room} · ${lobby.players.length} commander${lobby.players.length === 1 ? '' : 's'}`, 'good');
      await refreshHome();
      replace('lobby');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const codeField = (
    <input
      className="field"
      placeholder="Room code (4 letters)"
      maxLength={4}
      value={code}
      onChange={(e) => setCode(e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase())}
      data-testid="room-code"
      autoCapitalize="characters"
    />
  );

  return (
    <div className="screen">
      <Header title="Play with Friends" subtitle="Same Wi-Fi, same realm." onBack={back} />
      <div className="split">
        <div className="col" style={{ gap: 8 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            <Wifi size={16} /> Your Wi-Fi
          </div>
          {scanning ? <Spinner label="Searching your Wi-Fi for a host…" /> : null}
          {found.map((h) => (
            <div key={h.base} className="card row" style={{ gap: 10 }} data-testid="host-found">
              <Laptop size={22} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>
                  Host found: {h.hostName} ({h.ip})
                </b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {h.players} commander{h.players === 1 ? '' : 's'} in the room
                </div>
              </div>
              <button className="btn go small" onClick={() => setPick(h)} data-testid="join-host">
                JOIN
              </button>
            </div>
          ))}
          {!scanning && !found.length ? (
            <div className="card" data-testid="no-host">
              No host found. Ask your friend to run the game server on the same Wi-Fi, then try again.{' '}
              <button className="btn ghost small" onClick={() => setHelp(true)} data-testid="how-to-host">
                How to host
              </button>
            </div>
          ) : null}
          {!scanning ? (
            <button className="btn ghost small" onClick={search} data-testid="search-again">
              <Search size={14} /> Search again
            </button>
          ) : null}
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Enter host address
          </div>
          <input className="field" placeholder="192.168.1.12" value={ip} onChange={(e) => setIp(e.target.value.trim())} inputMode="decimal" data-testid="host-ip" />
          {codeField}
          <button className="btn ember big block" disabled={busy || !ip} onClick={() => connect(hostBase(ip))} data-testid="connect">
            {busy ? 'Connecting…' : 'CONNECT'}
          </button>
          <p className="small-note" style={{ margin: 0 }}>
            Your realm on this phone stays as it is. In a friend's room you play a commander on their laptop, with your General.{' '}
            <button className="btn ghost small" onClick={() => setHelp(true)}>
              How to host
            </button>
          </p>
        </div>
      </div>
      {pick ? (
        <Modal title={`Join ${pick.hostName}`} onClose={() => setPick(null)} testId="join-sheet">
          <p style={{ marginTop: 0, fontWeight: 700 }}>Type the room code shown on the host's screen.</p>
          {codeField}
          <button className="btn ember big block" style={{ marginTop: 8 }} disabled={busy} onClick={() => connect(pick.base)} data-testid="connect-found">
            {busy ? 'Connecting…' : 'CONNECT'}
          </button>
        </Modal>
      ) : null}
      {help ? (
        <Modal title="How to host" onClose={() => setHelp(false)} testId="host-help">
          <ol style={{ margin: 0, paddingLeft: 20, fontWeight: 700, lineHeight: 1.5 }}>
            <li>On a laptop on the same Wi-Fi, open the realm-raiders folder.</li>
            <li>
              Run <code>pnpm dev:lan</code>. It prints the address, a 4-letter room code and a QR code.
            </li>
            <li>Friends open Play with Friends: the laptop shows up as a host. Tap JOIN and type the code.</li>
            <li>Or open the printed page (http://&lt;address&gt;:8787/lan) on any phone to see the code.</li>
          </ol>
          <p className="small-note">Play with Friends needs a host on your Wi-Fi — the phones talk to the laptop, not to each other.</p>
        </Modal>
      ) : null}
    </div>
  );
}
