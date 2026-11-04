import { useEffect, useRef } from 'react';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { gameCtl } from './game/controller';
import { api } from './net/api';
import { StoreProvider, useReset, useStore } from './state';
import { Toasts } from './ui/components';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SignIn } from './screens/01-signin/SignIn';
import { GeneralScreen } from './screens/02-general/General';
import { Home } from './screens/03-home/Home';
import { Build } from './screens/04-build/Build';
import { Targets } from './screens/05-targets/Targets';
import { WarRoom } from './screens/06-warroom/WarRoom';
import { Battle } from './screens/07-battle/Battle';
import { Result } from './screens/08-result/Result';
import { Night } from './screens/09-night/Night';
import { Report } from './screens/10-report/Report';
import { Profile } from './screens/12-profile/Profile';
import { DevSim } from './dev/DevSim';
import { Friends } from './screens/13-friends/Friends';
import { Lobby } from './screens/14-lobby/Lobby';
import { Duel } from './screens/15-duel/Duel';
import { DuelResult } from './screens/16-duel-result/DuelResult';
import { Spectate } from './screens/07-battle/Spectate';
import { LanAlerts } from './ui/LanAlerts';
import { TipCard } from './ui/Tips';

/** Screens that show the Phaser canvas underneath their HUD. */
const CANVAS_SCREENS = new Set(['home', 'build', 'targets', 'battle', 'night', 'report', 'spectate']);

function Boot() {
  const reset = useReset();
  const { setMode, refreshHome } = useStore();
  useEffect(() => {
    void (async () => {
      if (location.hash === '#/dev/sim') return reset({ name: 'devsim' });
      if (Capacitor.isNativePlatform()) {
        void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
        void StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      }
      const mode = await api.init();
      setMode(mode);
      if (!api.session) return reset({ name: 'signin' });
      const home = await refreshHome();
      if (!home) return reset({ name: 'signin' });
      reset({ name: home.general ? 'home' : 'general' });
    })();
  }, [reset, setMode, refreshHome]);
  return (
    <div className="screen center col" style={{ gap: 14 }}>
      <div className="title" style={{ fontSize: 30 }}>
        Realm Raiders
      </div>
      <div className="flavour muted">Lighting the beacons of the Emberwake Isles…</div>
    </div>
  );
}

function Screens() {
  const { route, back } = useStore();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (host.current) gameCtl.mount(host.current);
  }, []);
  const showCanvas = CANVAS_SCREENS.has(route.name);
  useEffect(() => {
    gameCtl.sleep(!showCanvas);
  }, [showCanvas]);
  let screen;
  switch (route.name) {
    case 'boot':
      screen = <Boot />;
      break;
    case 'signin':
      screen = <SignIn />;
      break;
    case 'general':
      screen = <GeneralScreen />;
      break;
    case 'home':
      screen = <Home />;
      break;
    case 'build':
      screen = <Build />;
      break;
    case 'targets':
      screen = <Targets />;
      break;
    case 'warroom':
      screen = <WarRoom />;
      break;
    case 'battle':
      screen = <Battle />;
      break;
    case 'result':
      screen = <Result />;
      break;
    case 'night':
      screen = <Night />;
      break;
    case 'report':
      screen = <Report />;
      break;
    case 'profile':
      screen = <Profile />;
      break;
    case 'devsim':
      screen = <DevSim />;
      break;
    case 'friends':
      screen = <Friends />;
      break;
    case 'lobby':
      screen = <Lobby />;
      break;
    case 'duel':
      screen = <Duel />;
      break;
    case 'duel-result':
      screen = <DuelResult />;
      break;
    case 'spectate':
      screen = <Spectate />;
      break;
  }
  return (
    <div className="app">
      <div ref={host} className={`stage${showCanvas ? '' : ' hidden'}`} data-testid="game" />
      <ErrorBoundary resetKey={route.name} onBack={back}>
        {screen}
      </ErrorBoundary>
      <Toasts />
      <LanAlerts />
      <TipCard screen={route.name} key={route.name} />
      {/* Landscape only (spec F1): portrait browsers get this card; the Android app is locked to landscape. */}
      <div className="rotate-card" data-testid="rotate-card">
        <div className="phone" />
        <div className="title" style={{ fontSize: 26 }}>
          Rotate your phone to play
        </div>
        <div className="subtitle">Realm Raiders is played sideways, like a real war table.</div>
      </div>
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Screens />
    </StoreProvider>
  );
}
