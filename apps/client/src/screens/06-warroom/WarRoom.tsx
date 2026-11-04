import { useEffect, useRef, useState } from 'react';
import { Swords, Wand2 } from 'lucide-react';
import { troopLabel } from '@realm/game-data';
import { COACHING_CHIPS, type PlanId } from '@realm/game-data';
import { channels, randomHex32, type BattleCommitDTO, type PlanDTO, type WarRoomDTO } from '@realm/shared';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { Header, OfficerBubble, Spinner, Stars } from '../../ui/components';
import { sfx } from '../../audio/sfx';

function Counter({ plan, progress }: { plan: PlanDTO; progress: number }) {
  if (plan.stats)
    return (
      <div className="row plan-stats">
        <span className="win">{plan.stats.winRate}% wins</span>
        <Stars n={Math.round(plan.stats.avgStars)} />
        <span className="muted">{plan.stats.avgSeconds}s</span>
      </div>
    );
  return (
    <div className="row" style={{ marginTop: 6, color: 'var(--ink)' }}>
      <span className="spin">⚙</span>
      <span className="num">Practising {progress}/50</span>
    </div>
  );
}

/** 06 — War Room: three plans × 50 practice raids, Strategist coaching, then lock the seed. */
export function WarRoom() {
  const { route, back, fail, home, setBattle, go, toast } = useStore();
  const islandId = String(route.params?.islandId ?? '');
  const [room, setRoom] = useState<WarRoomDTO | null>(null);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<PlanId | null>(null);
  const [note, setNote] = useState('');
  const [coaching, setCoaching] = useState(false);
  const [locking, setLocking] = useState(false);
  const roomRef = useRef<WarRoomDTO | null>(null);

  useEffect(() => {
    let unsub = () => {};
    let poll: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    api
      .post<WarRoomDTO>('/warroom', { targetIslandId: islandId })
      .then((r) => {
        if (!alive) return;
        roomRef.current = r;
        setRoom(r);
        unsub = api.subscribe(channels.warroom(r.warRoomId), (m) => {
          if (m.t === 'sim') {
            const d = m.d as { planId: string; done: number; stats?: PlanDTO['stats'] };
            setProgress((p) => ({ ...p, [d.planId]: d.done }));
            if (d.stats) setRoom((x) => (x ? { ...x, plans: x.plans.map((p) => (p.planId === d.planId ? { ...p, stats: d.stats! } : p)) } : x));
          } else if (m.t === 'warroom') {
            setRoom(m.d as WarRoomDTO);
            sfx.play('star');
          }
        });
        // Backup poll in case a socket frame is missed.
        poll = setInterval(async () => {
          const w = await api.get<WarRoomDTO & { status: string }>(`/warroom/${r.warRoomId}`).catch(() => null);
          if (w && w.status === 'ready') {
            setRoom(w);
            if (poll) clearInterval(poll);
          }
        }, 1500);
      })
      .catch((e) => {
        fail(e);
        back();
      });
    return () => {
      alive = false;
      unsub();
      if (poll) clearInterval(poll);
    };
  }, [islandId, fail, back]);

  useEffect(() => {
    if (room && !selected && room.plans.every((p) => p.stats)) setSelected(room.recommended);
  }, [room, selected]);

  const coach = async (text: string) => {
    if (!room || !selected) return toast('Pick a plan to coach first.');
    setCoaching(true);
    try {
      const r = await api.post<{ plan: PlanDTO }>(`/warroom/${room.warRoomId}/coach`, { planId: selected, note: text });
      setRoom((x) => (x ? { ...x, plans: x.plans.map((p) => (p.planId === r.plan.planId ? r.plan : p)) } : x));
      setNote('');
      sfx.play('star');
    } catch (e) {
      fail(e);
    } finally {
      setCoaching(false);
    }
  };

  const lock = async () => {
    if (!room || !selected) return;
    setLocking(true);
    try {
      const commit = await api.post<BattleCommitDTO>('/battle/commit', { warRoomId: room.warRoomId, planId: selected, attackerNonce: randomHex32() });
      sfx.play('seal');
      setBattle({ commit });
      go('battle');
    } catch (e) {
      fail(e);
      setLocking(false);
    }
  };

  if (!room) return <div className="screen"><Header title="War Room" onBack={back} /><Spinner label="Spreading the maps…" /></div>;
  const ready = room.plans.every((p) => p.stats);
  const plan = room.plans.find((p) => p.planId === selected);
  return (
    <div className="screen">
      <Header
        title="War Room"
        subtitle={`${room.target.name} · Sefa tries every plan 50 times first`}
        onBack={back}
        right={
          <div className="col" style={{ alignItems: 'flex-end', gap: 2 }}>
            <button className="btn ember" disabled={!ready || !plan?.affordable || locking} onClick={lock} data-testid="lock">
              <Swords size={18} /> {locking ? 'Getting ready…' : 'ATTACK!'}
            </button>
            {plan && !plan.affordable ? (
              <span className="bad-text" style={{ fontSize: 12 }}>
                Not enough {plan.cost.ember > (home?.economy.ember ?? 0) ? 'Ember' : 'Timber'} for this army.
              </span>
            ) : null}
          </div>
        }
      />
      <div className="grid3" style={{ gap: 10, alignItems: 'stretch' }}>
        {room.plans.map((p) => (
          <button
            key={p.planId}
            className="card col"
            style={{
              textAlign: 'left',
              gap: 4,
              boxShadow: selected === p.planId ? 'inset 0 0 0 3px var(--attack), 0 0 0 3px #fff, 0 4px 0 rgba(0,0,0,.35)' : undefined,
              opacity: p.affordable ? 1 : 0.65,
            }}
            onClick={() => setSelected(p.planId)}
            data-testid={`plan-${p.planId}`}
          >
            <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: 17, flex: 1 }}>{p.name}</h3>
              {room.recommended === p.planId && ready ? <span className="chip brass">Best</span> : null}
            </div>
            <div style={{ fontSize: 13, fontWeight: 700 }}>
              {p.army.troops.map((e) => troopLabel(e.troop, e.count)).join(' · ')}
            </div>
            <Counter plan={p} progress={progress[p.planId] ?? 0} />
            <div className={p.affordable ? 'muted' : 'bad-text'} style={{ fontSize: 12, fontWeight: 800 }}>
              {p.cost.timber} Timber{p.cost.ember ? ` · ${p.cost.ember} Ember` : ''}
              {p.affordable ? '' : ' — not enough'}
            </div>
            {p.coachNote ? <div style={{ fontSize: 12, color: 'var(--ink-2)' }}>Your order: “{p.coachNote}”</div> : null}
          </button>
        ))}
      </div>
      <div className="split" style={{ marginTop: 10 }}>
        <OfficerBubble role="strategist" name="Captain Sefa" loading={!ready}>
          {room.thoughts.slice(0, 2).map((t, i) => (
            <div key={i}>{t}</div>
          ))}
        </OfficerBubble>
        <div className="col" style={{ gap: 6 }}>
          <div className="section-title" style={{ margin: 0 }}>
            Give Sefa an order
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {COACHING_CHIPS.map((c) => (
              <button key={c} className="chip tappable" disabled={!ready || coaching} onClick={() => coach(c)}>
                {c}
              </button>
            ))}
          </div>
          <div className="row">
            <input className="field" placeholder="e.g. attack from the east" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
            <button className="btn small" disabled={!note.trim() || coaching || !ready} onClick={() => coach(note)} aria-label="Coach">
              <Wand2 size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
