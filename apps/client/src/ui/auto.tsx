import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, Circle, Gem, Hand, Lock, XCircle } from 'lucide-react';
import { AUTO_DURATIONS, AUTO_GEMS_PER_BLOCK, autoCost, type AutoMinutes } from '@realm/game-data';
import { AUTO_BLOCKED, DEFAULT_AUTO_ORDERS, type AutoLogEntry, type AutoOrdersDraft, type AutoSessionDTO, type HomeDTO } from '@realm/shared';
import { useWallet } from '../auth/bridge';
import { commitPolicy } from '../chain/tx';
import { api } from '../net/api';
import { useStore } from '../state';
import { sfx } from '../audio/sfx';
import { ChainChip } from './components';
import { Modal, OFFICER_SHORT, type TickerLine } from './hud';
import { visibleInterval } from './lib/visible-interval';

/** Auto Mode on the phone (spec F8 + the section 4 copy). The officers' work itself runs in the core. */
export const autoRunning = (home: HomeDTO | null) => home?.auto?.status === 'running';
export { AUTO_BLOCKED };

export const durationText = (m: number) => (m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? '' : 's'}`);

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** "23:41" (or "1:23:41"). */
export function leftText(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The latest session while Auto Mode runs (polled; the scheduler does the work). */
export function useAutoFeed(running: boolean) {
  const [session, setSession] = useState<AutoSessionDTO | null>(null);
  useEffect(() => {
    if (!running) return;
    const load = () =>
      void api
        .get<{ session: AutoSessionDTO | null }>('/auto')
        .then((r) => setSession(r.session))
        .catch(() => {});
    load();
    return visibleInterval(load, 4000);
  }, [running]);
  return running ? session : null;
}

export function officerName(o: AutoLogEntry['officer'], general: string) {
  return o === 'general' ? general : (OFFICER_SHORT[o] ?? o);
}

/** The live action feed in the officer ticker: the newest moves first. */
export function autoTickerLines(s: AutoSessionDTO | null, general: string): TickerLine[] {
  if (!s) return [{ who: OFFICER_SHORT.night_captain!, role: 'night_captain', text: 'Your officers are taking their posts…' }];
  return s.log
    .slice(-4)
    .reverse()
    .map((e) => ({
      who: officerName(e.officer, general),
      role: e.officer,
      text: e.kind === 'note' || e.text.endsWith('✓') ? e.text : e.allowed ? `${e.text} ✓` : `${e.text} ✗ (${e.reason})`,
    }));
}

/** Right side, under the resources: AUTO with an on/off light. Off → start; on → the Auto Log. */
export function AutoButton({ home, onStart, onLog }: { home: HomeDTO; onStart(): void; onLog(): void }) {
  const on = home.auto?.status === 'running';
  return (
    <button className={`adviser auto${on ? ' on' : ''}`} onClick={on ? onLog : onStart} data-testid="auto-card" aria-label={on ? 'Auto Mode is on — read the Auto Log' : 'Auto Mode'}>
      <Bot size={22} />
      <span className="light">{on ? 'ON' : 'OFF'}</span>
      <span className="lbl">Auto</span>
    </button>
  );
}

/** The big button that stops Auto Mode at once (it takes RAID!'s place while the officers play). */
export function TakeControl({ onStop }: { onStop(): void }) {
  return (
    <button className="round-btn raid take-control" onClick={onStop} data-testid="take-control" aria-label="TAKE CONTROL">
      <Hand size={30} strokeWidth={2.6} />
      <span className="lbl" style={{ fontSize: 13, lineHeight: 1 }}>
        TAKE
        <br />
        CONTROL
      </span>
    </button>
  );
}

export function AutoChip({ home }: { home: HomeDTO }) {
  const now = useNow();
  if (home.auto?.status !== 'running') return null;
  return (
    <span className="chip auto" data-testid="auto-chip">
      AUTO · {leftText(home.auto.endsAt - now - (home.now - Date.now()))} left
    </span>
  );
}

/** Duration → Auto Orders → seal. */
export function AutoStartSheet({ home, onClose, onStarted }: { home: HomeDTO; onClose(): void; onStarted(s: AutoSessionDTO): void }) {
  const { fail, toast } = useStore();
  const wallet = useWallet();
  const gems = home.economy.gems;
  const [step, setStep] = useState<'time' | 'orders'>('time');
  const [minutes, setMinutes] = useState<AutoMinutes>(60);
  const [orders, setOrders] = useState<AutoOrdersDraft>(DEFAULT_AUTO_ORDERS);
  const [, setDraft] = useState<{ fallback: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .post<{ output: AutoOrdersDraft; fallback: boolean }>('/agents/night_captain/auto')
      .then((r) => {
        if (!alive) return;
        setOrders({ ...DEFAULT_AUTO_ORDERS, ...r.output });
        setDraft({ fallback: r.fallback });
      })
      .catch(() => alive && setDraft({ fallback: true }));
    return () => {
      alive = false;
    };
  }, []);
  const set = <K extends keyof AutoOrdersDraft>(k: K, v: AutoOrdersDraft[K]) => setOrders((o) => ({ ...o, [k]: v }));
  const cost = autoCost(minutes);
  const seal = async () => {
    setBusy(true);
    try {
      const prep = await api.post<{ nightId: number; policyHash: `0x${string}`; expiresAt: number }>('/auto/prepare', { minutes, orders });
      const s = await commitPolicy<AutoSessionDTO>(wallet, home.chainMode, prep, '/auto/confirm');
      sfx.play('auto');
      toast('Orders locked ✓ — your officers are in charge', 'good');
      onStarted(s);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  if (step === 'time')
    return (
      <Modal title="How long should your officers take over?" onClose={onClose} testId="auto-duration">
        <div className="dur-grid">
          {AUTO_DURATIONS.map((m) => (
            <button key={m} className={`dur ${m === minutes ? 'on' : ''}`} onClick={() => setMinutes(m)} data-testid={`auto-${m}`}>
              <b>{durationText(m)}</b>
              <span>
                <Gem size={12} /> {autoCost(m)} Gems
              </span>
            </button>
          ))}
        </div>
        <p className="small-note" style={{ marginTop: 10 }}>
          {AUTO_GEMS_PER_BLOCK} Gems per 30 minutes, paid as each half-hour starts. Take control any time — blocks that haven't started cost nothing.
          {gems < cost ? ` You have ${gems} Gems, so Auto Mode stops when they run out.` : ` You have ${gems} Gems.`}
        </p>
        <button className="btn go big block" style={{ marginTop: 10 }} disabled={gems < AUTO_GEMS_PER_BLOCK} onClick={() => setStep('orders')} data-testid="auto-next">
          {gems < AUTO_GEMS_PER_BLOCK ? 'Not enough Gems' : 'NEXT · AUTO ORDERS'}
        </button>
      </Modal>
    );
  return (
    <Modal title="Auto Orders" onClose={onClose} testId="auto-orders" wide>
      <div className="muted" style={{ fontWeight: 800, marginTop: -8 }}>
        Your officers will follow these rules and nothing else.
      </div>
      <div className="small-note" style={{ margin: '2px 0 6px' }}>
        ☾ Watch-Captain Hale drafted these from your walls — change anything you like.
      </div>
      <div className="orders-grid">
        <label>
          <span>Raids per hour: {orders.raidsPerHour}</span>
          <div className="pill-toggle sm">
            {[0, 1, 2, 3, 4].map((n) => (
              <button key={n} className={orders.raidsPerHour === n ? 'on' : ''} onClick={() => set('raidsPerHour', n)}>
                {n}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>Only raid if win chance is at least: {orders.minWinPct}%</span>
          <input type="range" min={50} max={100} step={5} value={orders.minWinPct} onChange={(e) => set('minWinPct', Number(e.target.value))} data-testid="auto-win" />
        </label>
        <label>
          <span>Keep Gold in reserve: {orders.reserveGoldPct}%</span>
          <input type="range" min={0} max={80} step={5} value={orders.reserveGoldPct} onChange={(e) => set('reserveGoldPct', Number(e.target.value))} />
        </label>
        <label>
          <span>Upgrade first</span>
          <div className="pill-toggle sm">
            {(['defences', 'resources', 'army'] as const).map((k) => (
              <button key={k} className={orders.upgradeFirst === k ? 'on' : ''} onClick={() => set('upgradeFirst', k)}>
                {k[0]!.toUpperCase() + k.slice(1)}
              </button>
            ))}
          </div>
        </label>
        <label>
          <span>Strike back at raiders</span>
          <div className="pill-toggle sm">
            <button className={orders.strikeBack ? 'on' : ''} onClick={() => set('strikeBack', true)}>
              Yes
            </button>
            <button className={!orders.strikeBack ? 'on' : ''} onClick={() => set('strikeBack', false)}>
              No
            </button>
          </div>
        </label>
        <label>
          <span>Storm-shield if a raid takes {orders.shieldAtPct}%</span>
          <input type="range" min={10} max={100} step={5} value={orders.shieldAtPct} onChange={(e) => set('shieldAtPct', Number(e.target.value))} />
        </label>
      </div>
      <div className="row" style={{ marginTop: 8, gap: 8, alignItems: 'stretch' }}>
        <div className="card row" style={{ padding: '4px 10px', gap: 6, flex: 1, minWidth: 0 }}>
          <Gem size={16} color="var(--gems)" />
          <div style={{ minWidth: 0 }}>
            <b>
              {durationText(minutes)} · {cost} Gems
            </b>
            <div className="muted" style={{ fontSize: 11 }}>
              {AUTO_GEMS_PER_BLOCK} now, then {AUTO_GEMS_PER_BLOCK} each half-hour
            </div>
          </div>
        </div>
        <button className="btn ember big" style={{ flex: 1.3 }} onClick={seal} disabled={busy} data-testid="auto-seal">
          <Lock size={18} /> {busy ? 'Sealing…' : 'SEAL ORDERS & START'}
        </button>
      </div>
      <p className="small-note" style={{ margin: '4px 0 0', textAlign: 'right' }}>
        Orders are locked on Monad, so the officers can't break them.
      </p>
    </Modal>
  );
}

/** Shown once when a session ended while you weren't looking (finished or out of Gems). */
export function AutoEndModal({ auto, onClose, onRead }: { auto: NonNullable<HomeDTO['auto']>; onClose(): void; onRead(): void }) {
  useEffect(() => {
    // Opening the result marks the session as seen.
    void api.get('/auto').catch(() => {});
  }, []);
  const moves = `${auto.moves} move${auto.moves === 1 ? '' : 's'}`;
  return (
    <Modal title={auto.status === 'out_of_gems' ? 'Out of Gems' : 'Auto Mode finished'} onClose={onClose} testId="auto-ended">
      <p style={{ fontWeight: 800, marginTop: 0 }} data-testid="auto-ended-text">
        {auto.status === 'out_of_gems'
          ? 'Out of Gems — Auto Mode stopped. Earn more by raiding and winning duels.'
          : `Auto Mode finished. Your officers made ${moves}. Read the Auto Log.`}
      </p>
      <div className="grid2">
        <button className="btn ember" onClick={onRead} data-testid="read-auto-log">
          Read the Auto Log
        </button>
        <button className="btn ghost" onClick={onClose}>
          OK
        </button>
      </div>
    </Modal>
  );
}

const kindLabel: Partial<Record<AutoLogEntry['kind'], string>> = { raid: 'Raid', collect: 'Collect', upgrade: 'Upgrade', build: 'Build', reseal: 'Seal', layout: 'Layout', repair: 'Repair', strikeback: 'Strike back', shield: 'Shield' };

/** The Auto Log (Report → Auto Log): every move, ✓ within orders or ✗ refused, with its Ledger entry. */
export function AutoLogView({ session, general }: { session: AutoSessionDTO; general: string }) {
  const t0 = session.startedAt;
  const stamp = (at: number) => {
    const m = Math.max(0, Math.round((at - t0) / 60_000));
    return `+${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  };
  return (
    <div className="col autolog" data-testid="auto-log">
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className={`chip ${session.status === 'running' ? 'auto' : 'good'}`}>
          {session.status === 'running' ? 'Running' : session.status === 'out_of_gems' ? 'Out of Gems' : session.status === 'stopped' ? 'You took control' : 'Finished'}
        </span>
        <span className="chip">
          {session.moves} move{session.moves === 1 ? '' : 's'} · {session.gemsSpent} Gems
        </span>
        <span className="chip good" title={session.ordersHash}>Orders locked ✓</span>
        <ChainChip tx={session.commitTx} label="PolicyCommitted" />
      </div>
      <ul className="small-note" style={{ margin: '4px 0 6px', paddingLeft: 18 }}>
        {session.summary.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {[...session.log].reverse().map((e, i) => (
        <div key={`${e.at}-${i}`} className={`panel row entry ${e.kind === 'note' ? 'note' : e.allowed ? 'ok' : 'refused'}`} data-testid="auto-entry">
          {e.kind === 'note' ? <Circle size={12} color="var(--muted)" /> : e.allowed ? <CheckCircle2 size={16} color="var(--good)" /> : <XCircle size={16} color="var(--bad)" />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13 }}>
              <b>{officerName(e.officer, general)}:</b> {e.text}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              {stamp(e.at)} · {e.kind === 'note' ? 'note' : `${kindLabel[e.kind] ?? e.kind} · ${e.allowed ? 'within orders ✓' : `refused: ${e.reason}`}`}
            </div>
          </div>
          {e.tx ? <ChainChip tx={e.tx} label={e.kind === 'note' ? 'Ledger' : 'Autopilot'} /> : null}
        </div>
      ))}
    </div>
  );
}
