import { useEffect, useState } from 'react';
import { CheckCircle2, Swords, Timer } from 'lucide-react';
import { channels, type BattleCommitDTO, type DuelDTO, type WarRoomDTO } from '@realm/shared';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { ChainChip, Header, Spinner, Stars } from '../../ui/components';
import { sfx } from '../../audio/sfx';

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** 15 — Live Duel: one shared seed, 3 minutes; pick a plan against your friend's base and attack (spec F9). */
export function Duel() {
  const { route, setBattle, replace, fail, back } = useStore();
  const duelId = String(route.params?.duelId ?? '');
  const [duel, setDuel] = useState<DuelDTO | null>(null);
  const [room, setRoom] = useState<(WarRoomDTO & { status: string }) | null>(null);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const me = duel ? (duel.a.playerId === api.playerId ? duel.a : duel.b) : null;
  const foe = duel ? (me === duel.a ? duel.b : duel.a) : null;

  useEffect(() => {
    void api.get<DuelDTO>(`/duel/${duelId}`).then(setDuel).catch(fail);
    const off = api.subscribe(channels.duel(duelId), (m) => {
      if (m.t === 'duel' || m.t === 'duel-start') setDuel(m.d as DuelDTO);
      if (m.t === 'duel-result') replace('duel-result', { duelId });
    });
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => {
      off();
      clearInterval(t);
    };
  }, [duelId, fail, replace]);

  // My War Room against the friend's base runs on the host (150 practice raids).
  useEffect(() => {
    if (!me?.warRoomId || room?.status === 'ready') return;
    let alive = true;
    const poll = async () => {
      while (alive) {
        const w = await api.get<WarRoomDTO & { status: string }>(`/warroom/${me.warRoomId}`).catch(() => null);
        if (w) setRoom(w);
        if (w?.status === 'ready') return;
        await new Promise((r) => setTimeout(r, 600));
      }
    };
    void poll();
    return () => {
      alive = false;
    };
  }, [me?.warRoomId, room?.status]);

  useEffect(() => {
    if (me?.battleId) replace('duel-result', { duelId });
  }, [me?.battleId, duelId, replace]);

  if (!duel || !me || !foe) return <div className="screen"><Spinner label="Locking the shared seed…" /></div>;
  // Count down on the host's clock (the duel window is the host's).
  const left = duel.endsAt - now;
  const attack = async (planId: string) => {
    if (!room) return;
    setBusy(true);
    try {
      const commit = await api.post<BattleCommitDTO>('/battle/commit', { warRoomId: room.warRoomId, planId, duelId });
      sfx.play('seal');
      setBattle({ commit });
      replace('battle');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="screen">
      <Header title={`Live Duel vs ${foe.name}`} subtitle="3 minutes · most stars wins" onBack={back} />
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }} data-testid="duel-intro">
        <span className="chip good">
          <CheckCircle2 size={12} /> Fair duel ✓
        </span>
        <ChainChip tx={duel.seedTx} label="SeedLocked" />
        <span className={`chip ${left < 30_000 ? 'bad' : 'brass'}`} data-testid="duel-clock">
          <Timer size={12} /> {mmss(left)} left
        </span>
      </div>
      {!room || room.status !== 'ready' ? (
        <Spinner label={`Sefa runs 150 practice raids against ${foe.name}'s base…`} />
      ) : (
        <div className="grid3" style={{ gap: 10 }}>
          {room.plans.map((p) => (
            <div key={p.planId} className="card col" style={{ gap: 6 }} data-testid={`duel-plan-${p.planId}`}>
              <h3 style={{ fontSize: 18 }}>{p.name}</h3>
              <div className="muted duel-sum" style={{ fontSize: 12, fontWeight: 700 }}>
                {p.summary}
              </div>
              {p.stats ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Stars n={Math.round(p.stats.avgStars)} />
                  <b style={{ fontSize: 13 }}>
                    {Math.round(p.stats.winRate)}% win · {Math.round(p.stats.avgSeconds)} s
                  </b>
                </div>
              ) : null}
              <div style={{ fontSize: 12, fontWeight: 800 }}>
                {p.cost.timber} Timber{p.cost.ember ? ` · ${p.cost.ember} Ember` : ''}
              </div>
              <div className="spacer" />
              <button className="btn ember block" disabled={busy || !p.affordable || left <= 0} onClick={() => attack(p.planId)} data-testid={`duel-attack-${p.planId}`}>
                <Swords size={16} /> ATTACK
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
