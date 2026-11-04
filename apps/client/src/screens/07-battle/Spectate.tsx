import { useEffect, useState } from 'react';
import { Eye, Home } from 'lucide-react';
import { MAX_TICKS, type Action } from '@realm/battle-engine';
import { channels, type SpectateDTO } from '@realm/shared';
import { bus, type BattleSnapshot } from '../../game/bus';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { Mmss, Spinner, Stars } from '../../ui/components';
import './battle.css';

/**
 * Watch a friend raid your base, live (spec F9). The attacker's phone streams the actions it
 * applied; this phone re-simulates the same deterministic battle a moment behind, so what you
 * watch is exactly what the host will verify.
 */
export function Spectate() {
  const { route, replace, fail, refreshHome } = useStore();
  const battleId = String(route.params?.battleId ?? '');
  const [info, setInfo] = useState<SpectateDTO | null>(null);
  const [snap, setSnap] = useState<BattleSnapshot | null>(null);
  const [end, setEnd] = useState<{ stars: number; destructionPct: number } | null>(null);

  useEffect(() => {
    let alive = true;
    const pending: { actions: Action[]; tick: number }[] = [];
    let started = false;
    const off = api.subscribe(channels.battle(battleId), (m) => {
      if (m.t === 'live') {
        const d = m.d as { tick: number; actions: Action[] };
        if (started) gameCtl.feedBattle(d.actions, d.tick);
        else pending.push(d);
      }
      if (m.t === 'live-end') {
        setEnd(m.d as { stars: number; destructionPct: number });
        gameCtl.feedBattle([], MAX_TICKS + 1);
      }
    });
    void api
      .get<SpectateDTO>(`/battle/${battleId}/spectate`)
      .then((s) => {
        if (!alive) return;
        setInfo(s);
        gameCtl.startBattle({
          input: { ...s.input, actions: [] },
          autoplay: s.actions,
          autoplayOn: true,
          speed: 1,
          replay: true,
          spectate: { until: s.ended ? MAX_TICKS + 1 : s.tick },
        });
        started = true;
        // Frames that arrived while the battle was loading.
        for (const p of pending) gameCtl.feedBattle(p.actions.filter((a) => a.t >= s.tick), p.tick);
      })
      .catch((e) => {
        fail(e);
        replace('home');
      });
    const offTick = bus.on('battle-tick', setSnap);
    return () => {
      alive = false;
      off();
      offTick();
      gameCtl.stopBattle();
    };
  }, [battleId, fail, replace]);

  if (!info) return <div className="screen center"><Spinner label="Joining the live raid…" /></div>;
  return (
    <div className="overlay battle-hud" data-testid="spectate">
      <div className="hud-box battle-top" style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', padding: '6px 14px', borderRadius: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="chip bad">
          <Eye size={12} /> LIVE
        </span>
        <b>
          {info.attacker} is raiding {info.defender}
        </b>
        <Stars n={snap?.stars ?? 0} />
        <span className="num">{Math.round(snap?.destructionPct ?? 0)}%</span>
        <Mmss seconds={snap?.secondsLeft ?? 90} />
      </div>
      {end && snap?.ended ? (
        <div className="modal-back">
          <div className="panel brass modal col" style={{ gap: 8, alignItems: 'center' }} data-testid="spectate-end">
            <div className="title" style={{ fontSize: 24 }}>
              {end.stars >= 2 ? 'They broke through' : 'Your walls held'}
            </div>
            <Stars n={end.stars} big />
            <div style={{ fontWeight: 800 }}>{Math.round(end.destructionPct)}% razed — verified by the host</div>
            <button
              className="btn go big"
              onClick={() => {
                void refreshHome();
                replace('home');
              }}
            >
              <Home size={16} /> BACK TO ISLAND
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
