import { useEffect, useRef, useState } from 'react';
import { Flag, Gauge, Megaphone, Pause, Play, ShieldCheck } from 'lucide-react';
import { bytesToBase64, encodeReplay, type SimEvent } from '@realm/battle-engine';
import { BUILDINGS, TROOPS, type TroopId } from '@realm/game-data';
import { channels, type BattleSubmitDTO, type DuelDTO, type StrategistOutput } from '@realm/shared';
import { bus, type BattleSnapshot } from '../../game/bus';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { Mmss, Stars } from '../../ui/components';
import { troopThumb } from '../../ui/troopThumb';
import { music } from '../../audio/music';
import { screenAwake } from '../../ui/lib/native';
import { sfx } from '../../audio/sfx';
import './battle.css';

const ICON: Record<TroopId, string> = { shield: '🗡', longbow: '🏹', sapper: '💣', ravager: '🗿', drake: '🐉', general: '⚔', mage: '🔥' };

function localLine(e: SimEvent): string | null {
  switch (e.k) {
    case 'destroyed':
      if (e.type === 'wall') return 'Wall breached — pour through!';
      if (e.type === 'citadel') return 'The Citadel falls! That is a star.';
      if (BUILDINGS[e.type].defence) return `${BUILDINGS[e.type].name} down. Their cover is thinning.`;
      return null;
    case 'star':
      return `${e.stars} star${e.stars > 1 ? 's' : ''} in hand.`;
    case 'rally':
      return 'Rally! The line surges forward.';
    case 'trap':
      return 'Caltrops! Watch the ground.';
    case 'died':
      return e.troop === 'general' ? 'The General is down — fight on!' : null;
    default:
      return null;
  }
}

/** 07 — Live Battle: client-side engine with the on-chain seed; autoplay or take control. */
export function Battle() {
  const { battle, setBattle, go, replace, fail, generalSprite, home, toast } = useStore();
  const [snap, setSnap] = useState<BattleSnapshot | null>(null);
  const [autoplay, setAutoplay] = useState(!battle?.replay ? true : true);
  const [speed, setSpeed] = useState<1 | 2>(battle?.replay ? 2 : 1);
  const [paused, setPaused] = useState(false);
  const [selected, setSelected] = useState<TroopId | null>(null);
  const [ticker, setTicker] = useState<{ text: string; llm: boolean }>({ text: 'For the realm! The battle begins.', llm: false });
  const [submitting, setSubmitting] = useState(false);
  const lastLine = useRef(0);
  const snapRef = useRef<BattleSnapshot | null>(null);
  const replay = !!battle?.replay;

  useEffect(() => {
    if (!battle) return;
    const c = battle.commit;
    // The server fixed the rules at commit; older servers did not say, which meant v1.
    const input = { engineVersion: c.engineVersion ?? 1, seed: c.seed, base: c.base, army: c.army, actions: [] };
    gameCtl.startBattle({
      input: replay && battle.input ? { ...battle.input, actions: [] } : input,
      autoplay: replay && battle.input ? battle.input.actions : c.plan.actions,
      autoplayOn: true,
      speed: replay ? 2 : 1,
      replay,
      generalTexture: generalSprite,
    });
    screenAwake.hold(true);
    music.play('battle');
    return () => {
      screenAwake.hold(false);
      gameCtl.stopBattle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offs = [
      bus.on('battle-tick', (s) => {
        snapRef.current = s;
        setSnap(s);
        for (const e of s.events) {
          if (e.t <= lastLine.current) continue;
          const line = localLine(e);
          if (line) {
            lastLine.current = e.t;
            setTicker({ text: line, llm: false });
            if (e.k === 'star') sfx.play('star');
          }
        }
      }),
      bus.on('deploy-fail', ({ reason }) => setTicker({ text: reason, llm: false })),
      bus.on('battle-end', async ({ input }) => {
        if (replay) {
          replace('result');
          return;
        }
        if (!battle) return;
        setSubmitting(true);
        try {
          const bytes = encodeReplay(input);
          const submit = await api.post<BattleSubmitDTO>(`/battle/${battle.commit.battleId}/submit`, { replay: bytesToBase64(bytes) });
          setBattle({ ...battle, input, submit });
          if (battle.commit.duelId) return replace('duel-result', { duelId: battle.commit.duelId });
          replace('result');
        } catch (e) {
          fail(e);
          setBattle({ ...battle, input });
          replace('result');
        }
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [battle, replay, replace, setBattle, fail]);

  // Raid a friend / Live Duel: stream the applied actions (~0.5 s) so the defender watches live,
  // and send the duel mini-bar numbers; hear the opponent's.
  const live = !replay && !!battle?.commit.live;
  const duelId = battle?.commit.duelId;
  const [foe, setFoe] = useState<{ name: string; stars: number; pct: number } | null>(null);
  useEffect(() => {
    if (!live || !battle) return;
    let sent = 0;
    const t = setInterval(() => {
      const l = gameCtl.battleLive();
      if (l) {
        api.sendLive(battle.commit.battleId, l.tick, l.applied.slice(sent));
        sent = l.applied.length;
      }
      const s = snapRef.current;
      if (duelId && s) api.sendDuel(duelId, s.stars, s.destructionPct);
    }, 500);
    return () => clearInterval(t);
  }, [live, battle, duelId]);
  useEffect(() => {
    if (!duelId) return;
    let names: Record<string, string> = {};
    void api.get<DuelDTO>(`/duel/${duelId}`).then((d) => {
      names = { [d.a.playerId]: d.a.name, [d.b.playerId]: d.b.name };
      const other = d.a.playerId === api.playerId ? d.b : d.a;
      setFoe({ name: other.name, stars: other.live?.stars ?? 0, pct: other.live?.pct ?? 0 });
    });
    return api.subscribe(channels.duel(duelId), (m) => {
      if (m.t !== 'duel-progress') return;
      const d = m.d as { playerId: string; stars: number; pct: number };
      if (d.playerId !== api.playerId) setFoe({ name: names[d.playerId] ?? 'Opponent', stars: d.stars, pct: d.pct });
    });
  }, [duelId]);

  // The Strategist thinks out loud every 5 s while the battle runs (§14.2).
  useEffect(() => {
    if (replay) return;
    const t = setInterval(async () => {
      const s = snapRef.current;
      if (!s || s.ended) return;
      try {
        const r = await api.post<{ output: StrategistOutput; fallback: boolean; latencyMs: number }>('/agents/strategist/commentary', {
          tick: s.tick,
          destructionPct: s.destructionPct,
          stars: s.stars,
          alive: s.alive,
        });
        if (!r.fallback && r.latencyMs < 3000 && r.output.thoughts[0]) setTicker({ text: r.output.thoughts[0], llm: true });
      } catch {
        /* local lines keep flowing */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [replay]);

  if (!battle) {
    go('home');
    return null;
  }
  const scene = () => gameCtl.battle;
  const toggleAuto = () => {
    const next = !autoplay;
    setAutoplay(next);
    scene()?.setAutoplay(next);
  };
  const choose = (t: TroopId) => {
    const next = selected === t ? null : t;
    setSelected(next);
    scene()?.select(next);
    if (next && autoplay) {
      setAutoplay(false);
      scene()?.setAutoplay(false);
    }
  };
  const c = battle.commit;
  const s = snap;
  return (
    <div className="overlay battle-hud">
      {duelId ? (
        <div className="duel-bar" data-testid="duel-bar">
          You {s?.stars ?? 0}★ {Math.round(s?.destructionPct ?? 0)}% · {foe?.name ?? 'Opponent'} {foe?.stars ?? 0}★ {Math.round(foe?.pct ?? 0)}%
        </div>
      ) : null}
      <div className="battle-top">
        <div className="panel hud-box" style={{ minWidth: 70, textAlign: 'center' }}>
          <div className="muted tiny">TIME</div>
          <div style={{ fontSize: 22 }}>
            <Mmss seconds={s?.secondsLeft ?? 90} />
          </div>
        </div>
        <div className="panel hud-box" style={{ flex: 1, maxWidth: 420 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="num" style={{ fontSize: 15 }}>
              {c.targetName}
            </span>
            <Stars n={s?.stars ?? 0} />
          </div>
          <div className="meter" style={{ marginTop: 3 }}>
            <i style={{ width: `${s?.destructionPct ?? 0}%` }} />
          </div>
          <div className="num" style={{ fontSize: 13, marginTop: 1 }}>
            {Math.floor(s?.destructionPct ?? 0)}% razed
          </div>
        </div>
        <div className="spacer pass" />
        <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
          {replay ? (
            <span className="chip brass">Replay ×2</span>
          ) : (
            <button
              className="chip good tappable"
              onClick={() => toast("Fair play: this battle's dice were locked on Monad before it began, so no one can change the outcome.", 'info')}
              data-testid="seed-chip"
            >
              <ShieldCheck size={13} /> Fair play ✓
            </button>
          )}
        </div>
      </div>
      <div className="battle-ticker fade-in" key={ticker.text}>
        <span className="who">Sefa:</span> {ticker.text}
        {!ticker.llm ? null : <span className="muted tiny"> (live)</span>}
      </div>
      <div className="spacer" />
      {!replay && (
        <div className="battle-bottom">
          <div className="deploy-bar">
            {Object.entries(s?.remaining ?? {}).map(([t, n]) => (
              <button key={t} className={`troop${selected === t ? ' on' : ''}`} disabled={!n} onClick={() => choose(t as TroopId)} data-testid={`troop-${t}`}>
                <span className="ic">{troopThumb(t as TroopId) ? <img src={troopThumb(t as TroopId)!} alt="" /> : ICON[t as TroopId]}</span>
                <span className="n num">×{n}</span>
                <span className="nm">{TROOPS[t as TroopId].name}</span>
              </button>
            ))}
            <button className={`troop rally${s?.rallyActive ? ' on' : ''}`} disabled={!s?.rallyReady} onClick={() => scene()?.rally()}>
              <Megaphone size={20} />
              <span className="nm">Rally</span>
            </button>
          </div>
          <div className="spacer pass" />
          <div className="battle-controls">
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" onClick={() => (setSpeed(speed === 1 ? 2 : 1), scene()?.setSpeed(speed === 1 ? 2 : 1))} aria-label="Speed">
                <Gauge size={16} />
                <span className="num tiny">×{speed}</span>
              </button>
              <button className="icon-btn" onClick={() => (setPaused(!paused), scene()?.setPaused(!paused))} aria-label="Pause">
                {paused ? <Play size={18} /> : <Pause size={18} />}
              </button>
              <button className="icon-btn" style={{ background: 'linear-gradient(180deg, var(--danger-hi), var(--danger))' }} onClick={() => scene()?.end()} aria-label="End battle" data-testid="end-battle">
                <Flag size={18} />
              </button>
            </div>
            <div className="pill-toggle">
              <button className={autoplay ? 'on' : ''} onClick={() => !autoplay && toggleAuto()} data-testid="autoplay">
                Autoplay plan
              </button>
              <button className={!autoplay ? 'on' : ''} onClick={() => autoplay && toggleAuto()}>
                Take control
              </button>
            </div>
          </div>
        </div>
      )}
      {submitting ? (
        <div className="modal-back">
          <div className="panel brass center col" style={{ padding: 24 }}>
            <div className="spin" style={{ fontSize: 30 }}>
              ⚙
            </div>
            <div className="flavour">Checking your raid…</div>
          </div>
        </div>
      ) : null}
      <span hidden>{home?.player.id}</span>
    </div>
  );
}
