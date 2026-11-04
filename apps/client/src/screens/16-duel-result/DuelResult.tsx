import { useEffect, useState } from 'react';
import { Home, RotateCcw } from 'lucide-react';
import { GEM_REWARDS } from '@realm/game-data';
import { channels, type DuelDTO } from '@realm/shared';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { ChainChip, Spinner } from '../../ui/components';
import { sfx } from '../../audio/sfx';

const DUEL_RENOWN = 20;

/** 16 — Duel Result: waits for the friend's replay (20 s if they drop), then VICTORY / DEFEAT / DRAW. */
export function DuelResult() {
  const { route, replace, fail, toast, refreshHome } = useStore();
  const duelId = String(route.params?.duelId ?? '');
  const [duel, setDuel] = useState<DuelDTO | null>(null);
  const [wait, setWait] = useState<{ name: string; until: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => void api.get<DuelDTO>(`/duel/${duelId}`).then(setDuel).catch(fail);
    load();
    const off = api.subscribe(channels.duel(duelId), (m) => {
      if (m.t === 'duel' || m.t === 'duel-result') setDuel(m.d as DuelDTO);
      if (m.t === 'duel-progress') setDuel((d) => (d ? patchLive(d, m.d as { playerId: string; stars: number; pct: number }) : d));
      if (m.t === 'duel-wait') setWait(m.d as { name: string; until: number });
      if (m.t === 'duel-back') setWait(null);
    });
    const poll = setInterval(load, 4000);
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      off();
      clearInterval(poll);
      clearInterval(t);
    };
  }, [duelId, fail]);
  const decided = duel?.status === 'decided';
  useEffect(() => {
    if (!decided || !duel) return;
    sfx.play(duel.winner === api.playerId ? 'victory' : 'defeat');
    void refreshHome();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decided]);

  if (!duel) return <div className="screen center"><Spinner label="Reading the duel…" /></div>;
  const me = duel.a.playerId === api.playerId ? duel.a : duel.b;
  const foe = me === duel.a ? duel.b : duel.a;
  const line = (s: typeof me) => `${s.stars ?? s.live?.stars ?? 0}★ ${Math.round(s.destructionPct ?? s.live?.pct ?? 0)}%`;
  const won = duel.winner === me.playerId;
  const rematch = async () => {
    try {
      await api.post('/duel/invite', { to: foe.playerId });
      toast(`Rematch sent to ${foe.name}…`, 'info');
      replace('lobby');
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="screen center col" style={{ gap: 10 }} data-testid="duel-result">
      {!decided ? (
        <>
          <Spinner label={wait ? `${wait.name} lost connection. Waiting ${Math.max(0, Math.ceil((wait.until - now) / 1000))} s…` : `Waiting for ${foe.name}'s replay…`} />
          <div className="chip brass" data-testid="duel-live-bar">
            You {line(me)} · {foe.name} {line(foe)}
          </div>
        </>
      ) : (
        <>
          <div className={`title duel-verdict ${won ? 'win' : duel.winner === 'draw' ? 'draw' : 'loss'}`} style={{ fontSize: 46 }} data-testid="duel-verdict">
            {won ? 'VICTORY' : duel.winner === 'draw' ? 'DRAW' : 'DEFEAT'}
          </div>
          <div style={{ fontWeight: 800, fontSize: 18 }} data-testid="duel-score">
            You {line(me)} vs {foe.name} {line(foe)}
          </div>
          {duel.decidedBy === 'disconnect' || duel.decidedBy === 'timeout' ? <div className="muted">Duel decided by recorded replays.</div> : null}
          {duel.resultTx ? (
            <div className="row" style={{ gap: 6 }}>
              <span className="chip good">Duel recorded on Monad ✓</span>
              <ChainChip tx={duel.resultTx} label="DuelRecorded" />
            </div>
          ) : null}
          {won ? (
            <span className="chip gems" data-testid="duel-reward">
              +{GEM_REWARDS.duelWin} Gems · +{DUEL_RENOWN} Renown
            </span>
          ) : null}
          <div className="row" style={{ gap: 8 }}>
            <button className="btn info big" onClick={rematch} data-testid="rematch">
              <RotateCcw size={16} /> REMATCH
            </button>
            <button className="btn go big" onClick={() => replace('home')} data-testid="duel-home">
              <Home size={16} /> BACK TO ISLAND
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function patchLive(d: DuelDTO, p: { playerId: string; stars: number; pct: number }): DuelDTO {
  const live = { stars: p.stars, pct: p.pct };
  return { ...d, a: d.a.playerId === p.playerId ? { ...d.a, live } : d.a, b: d.b.playerId === p.playerId ? { ...d.b, live } : d.b };
}
