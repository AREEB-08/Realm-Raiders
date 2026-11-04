import { useEffect, useMemo, useState } from 'react';
import { Hammer, LogOut, Moon, Music, Music2, ScrollText, Settings, Store, Swords, Users, Volume2, VolumeX } from 'lucide-react';
import { BUILDINGS } from '@realm/game-data';
import type { GeneralOutput } from '@realm/shared';
import { bus } from '../../game/bus';
import { gameCtl } from '../../game/controller';
import { registerGeneralSprite } from '../../game/generalSprite';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { GemsSheet, Modal, PlayerBadge, ResourceStack } from '../../ui/hud';
import { visibleInterval } from '../../ui/lib/visible-interval';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { ensureArmyArt } from '../../game/baked';
import { useArtProgress } from '../../ui/useArtProgress';
import { AUTO_BLOCKED, AutoButton, AutoChip, AutoEndModal, AutoStartSheet, TakeControl, autoRunning, autoTickerLines, useAutoFeed } from '../../ui/auto';

interface Floater {
  id: number;
  x: number;
  y: number;
  text: string;
}

type Sheet = null | 'gems' | 'settings' | 'auto';

function shieldLeft(until: number, now: number) {
  const left = until - now;
  if (left <= 0) return null;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** 03 — Home island (landscape base-builder HUD): symmetric, uncluttered, plain words. */
export function Home() {
  const { home, refreshHome, go, fail, generalSprite, setGeneralSprite, toast, signOut } = useStore();
  const [brief, setBrief] = useState<string | null>(null);
  const [bubbleOn, setBubbleOn] = useState(true);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [muted, setMuted] = useState(sfx.muted);
  const [musicOn, setMusicOn] = useState(music.enabled);
  const [endSeen, setEndSeen] = useState<string | null>(null);
  const autoOn = autoRunning(home);
  const feed = useAutoFeed(autoOn);

  useEffect(() => {
    void refreshHome();
    return visibleInterval(() => void refreshHome(), autoOn ? 4000 : 8000);
  }, [refreshHome, autoOn]);

  useEffect(() => {
    if (!home) return;
    gameCtl.showIsland({ layout: home.base.layout, mode: 'home', faction: home.general?.faction, economy: home.economy, timers: home.base.timers, look: 'day' });
    if (home.general && !generalSprite) setGeneralSprite(registerGeneralSprite(home.general.appearance, home.general.appearanceHash));
  }, [home, generalSprite, setGeneralSprite]);

  // Bake (first launch) or load (later) the 3D army sprites in the background.
  const generalHash = home?.general?.appearanceHash;
  useEffect(() => {
    if (!home) return;
    const g = home.general;
    void ensureArmyArt(gameCtl.game, g ? { appearance: g.appearance, hash: g.appearanceHash } : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!home, generalHash]);
  const forging = useArtProgress();

  useEffect(() => {
    music.play('home');
  }, []);

  // The General says one short line when you arrive (it fades by itself).
  useEffect(() => {
    let alive = true;
    api
      .post<{ output: GeneralOutput; fallback: boolean }>('/agents/general/briefing')
      .then((r) => alive && setBrief(r.output.greeting))
      .catch(() => {});
    const t = setTimeout(() => setBubbleOn(false), 9000);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    const offCollect = bus.on('collect', async ({ id, sx, sy }) => {
      if (autoRunning(home)) return toast(AUTO_BLOCKED, 'info');
      try {
        const r = await api.post<{ collected: number }>('/home/collect', { buildingId: id });
        if (r.collected > 0) {
          sfx.play('coin');
          const f = { id: Date.now(), x: sx, y: sy, text: `+${r.collected}` };
          setFloaters((x) => [...x, f]);
          setTimeout(() => setFloaters((x) => x.filter((y) => y.id !== f.id)), 900);
        } else toast('Storage is full — upgrade a Treasury or Timber Yard.', 'bad');
        void refreshHome();
      } catch (e) {
        fail(e);
      }
    });
    const offTap = bus.on('building-tap', ({ id }) => {
      const b = home?.base.layout.buildings.find((x) => x.id === id);
      if (b) toast(`${BUILDINGS[b.type].name} · level ${b.level}`);
    });
    return () => {
      offCollect();
      offTap();
    };
  }, [home, refreshHome, fail, toast]);

  const general = home?.general?.name ?? 'Your General';
  const autoLine = useMemo(() => (autoOn ? (autoTickerLines(feed, general)[0] ?? null) : null), [autoOn, feed, general]);

  if (!home) return null;
  const g = home.general;
  const eco = home.economy;
  const news = (role: string) => home.officers.find((o) => o.role === role)?.news;
  /** Manual play waits while Auto Mode runs ("tap Take Control to play yourself"). */
  const manual = (fn: () => void) => () => (autoOn ? toast(AUTO_BLOCKED, 'info') : fn());
  const takeControl = async () => {
    try {
      await api.post('/auto/stop');
      sfx.play('tap');
      toast('You have control again.', 'good');
      await refreshHome();
    } catch (e) {
      fail(e);
    }
  };
  const unsaved = !home.base.sealedHash || home.base.dirty;
  const shield = shieldLeft(eco.shieldUntil, home.now);

  return (
    <div className={`hud${autoOn ? ' auto-on' : ''}`} data-testid="home">
      {autoOn ? <div className="auto-glow" aria-hidden /> : null}
      <PlayerBadge general={g} renown={eco.renown} onClick={() => go('profile')} />
      <div className="hud-tr">
        <ResourceStack economy={eco} onGems={() => setSheet('gems')} />
      </div>

      {/* One status at a time, in the middle of the top edge. */}
      <div className="hud-tc">
        {autoOn ? (
          <AutoChip home={home} />
        ) : forging !== null ? (
          <span className="chip brass" data-testid="forging">
            ⚒ Preparing your army… {forging}%
          </span>
        ) : api.lan ? (
          <button className="chip info tappable" onClick={() => go('lobby')} data-testid="room-chip">
            Room {api.lan.room}
          </button>
        ) : unsaved ? (
          <button className="chip bad tappable" onClick={() => go('build')} data-testid="unsaved-chip">
            Base not saved — tap to save
          </button>
        ) : shield ? (
          <span className="chip info">🛡 Shield {shield}</span>
        ) : null}
      </div>

      {/* Left: your advisers; right: Auto Mode and settings — mirrored. */}
      <div className="home-side left">
        <button className="adviser" onClick={manual(() => go('build'))} data-testid="officer-architect" aria-label="Builder">
          <Hammer size={22} />
          {news('architect') ? <span className="dot" /> : null}
          <span className="lbl">Builder</span>
        </button>
        <button className="adviser" onClick={manual(() => go('night'))} data-testid="tab-night" aria-label="Night watch">
          <Moon size={22} />
          {news('night_captain') ? <span className="dot" /> : null}
          <span className="lbl">Night</span>
        </button>
        <button className="adviser" onClick={() => go('report', home.pendingReport ? undefined : { tab: 'auto' })} data-testid="officer-intel" aria-label="Reports">
          <ScrollText size={22} />
          {news('intel') ? <span className="dot" /> : null}
          <span className="lbl">Reports</span>
        </button>
      </div>
      <div className="home-side right">
        <AutoButton home={home} onStart={() => setSheet('auto')} onLog={() => go('report', { tab: 'auto' })} />
        <button className="adviser" onClick={() => setSheet('settings')} data-testid="settings" aria-label="Settings">
          <Settings size={22} />
          <span className="lbl">Settings</span>
        </button>
      </div>

      {/* The General's one line (or, in Auto Mode, the officers' latest move). */}
      {(bubbleOn && brief) || autoLine ? (
        <button className="speech fade-in" onClick={() => setBubbleOn(false)} data-testid="ticker">
          <b>{autoLine ? autoLine.who : general}:</b> {autoLine ? autoLine.text : brief}
        </button>
      ) : null}

      <div className="hud-bl">
        {autoOn ? (
          <TakeControl onStop={takeControl} />
        ) : (
          <button className="round-btn raid" onClick={() => go('targets')} data-testid="raid" aria-label="Attack">
            <Swords size={34} strokeWidth={2.6} />
            <span className="lbl">ATTACK</span>
          </button>
        )}
        <button className="round-btn info mid" onClick={manual(() => go(api.lan ? 'lobby' : 'friends'))} data-testid="friends" aria-label="Play with Friends">
          <Users size={22} />
          <span className="lbl">Friends</span>
        </button>
      </div>
      <div className="hud-br">
        <button className="round-btn wood mid" onClick={manual(() => go('build'))} data-testid="tab-build" aria-label="Build">
          <Hammer size={22} />
          <span className="lbl">Build</span>
          {unsaved ? <span className="dot" /> : null}
        </button>
        <button className="round-btn go raid" onClick={manual(() => go('build', { shop: true }))} data-testid="shop-home" aria-label="Shop">
          <Store size={32} />
          <span className="lbl">SHOP</span>
        </button>
      </div>

      {sheet === 'gems' ? <GemsSheet onClose={() => setSheet(null)} /> : null}
      {sheet === 'auto' ? (
        <AutoStartSheet
          home={home}
          onClose={() => setSheet(null)}
          onStarted={() => {
            setSheet(null);
            void refreshHome();
          }}
        />
      ) : null}
      {home.auto && home.auto.status !== 'running' && home.auto.status !== 'stopped' && endSeen !== home.auto.id ? (
        <AutoEndModal
          auto={home.auto}
          onClose={() => setEndSeen(home.auto!.id)}
          onRead={() => {
            setEndSeen(home.auto!.id);
            go('report', { tab: 'auto' });
          }}
        />
      ) : null}
      {sheet === 'settings' ? (
        <Modal title="Settings" onClose={() => setSheet(null)} testId="settings-sheet">
          <div className="list2">
            <button
              className="btn ghost"
              onClick={() => {
                sfx.muted = !sfx.muted;
                setMuted(sfx.muted);
              }}
              data-testid="sound-toggle"
            >
              {muted ? <VolumeX size={18} /> : <Volume2 size={18} />} Sound effects {muted ? 'off' : 'on'}
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                music.setEnabled(!music.enabled);
                setMusicOn(music.enabled);
              }}
              data-testid="music-toggle"
            >
              {musicOn ? <Music size={18} /> : <Music2 size={18} />} Music {musicOn ? 'on' : 'off'}
            </button>
            <button className="btn danger" onClick={signOut}>
              <LogOut size={18} /> Sign out
            </button>
          </div>
          <p className="small-note" style={{ marginTop: 10 }}>
            {api.mode === 'local' ? 'Playing on this phone.' : home.chainMode === 'live' ? 'Online · battles recorded on Monad.' : 'Online.'}
          </p>
        </Modal>
      ) : null}
      {floaters.map((f) => (
        <div key={f.id} className="float-num" style={{ left: f.x - 20, top: f.y - 40 }}>
          {f.text}
        </div>
      ))}
    </div>
  );
}
