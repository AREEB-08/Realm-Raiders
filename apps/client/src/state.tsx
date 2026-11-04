import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import type { BattleCommitDTO, BattleSubmitDTO, HomeDTO } from '@realm/shared';
import type { BattleInput } from '@realm/battle-engine';
import { api, ApiError, type BackendMode } from './net/api';
import { prefs } from './persist/prefs';
import { sfx } from './audio/sfx';

export type RouteName =
  | 'boot'
  | 'signin'
  | 'general'
  | 'home'
  | 'build'
  | 'targets'
  | 'warroom'
  | 'battle'
  | 'result'
  | 'night'
  | 'report'
  | 'profile'
  | 'devsim'
  | 'friends'
  | 'lobby'
  | 'duel'
  | 'duel-result'
  | 'spectate';

export interface Route {
  name: RouteName;
  params?: Record<string, unknown>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'good' | 'bad';
}

export interface BattleSession {
  commit: BattleCommitDTO;
  /** Filled when the battle ends. */
  input?: BattleInput;
  submit?: BattleSubmitDTO;
  /** Replay mode re-runs the recorded input. */
  replay?: boolean;
}

interface Store {
  route: Route;
  go(name: RouteName, params?: Record<string, unknown>): void;
  replace(name: RouteName, params?: Record<string, unknown>): void;
  back(): void;
  mode: BackendMode;
  setMode(m: BackendMode): void;
  home: HomeDTO | null;
  refreshHome(): Promise<HomeDTO | null>;
  courierDelayed: boolean;
  toast(text: string, kind?: Toast['kind']): void;
  toasts: Toast[];
  battle: BattleSession | null;
  setBattle(b: BattleSession | null): void;
  generalSprite: string | null;
  setGeneralSprite(key: string | null): void;
  signOut(): Promise<void>;
  fail(e: unknown): void;
}

const StoreCtx = createContext<Store | null>(null);
export const useStore = () => useContext(StoreCtx)!;

const HOME_CACHE = 'realm-raiders-home-cache';

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'boot' }]);
  const [mode, setMode] = useState<BackendMode>('local');
  const [home, setHome] = useState<HomeDTO | null>(null);
  const [courierDelayed, setCourier] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [battle, setBattle] = useState<BattleSession | null>(null);
  const [generalSprite, setGeneralSprite] = useState<string | null>(null);
  const toastId = useRef(0);
  const route = stack[stack.length - 1]!;

  const go = useCallback((name: RouteName, params?: Record<string, unknown>) => {
    sfx.play('tap');
    setStack((s) => (s[s.length - 1]?.name === name ? [...s.slice(0, -1), { name, params }] : [...s, { name, params }]));
  }, []);
  const replace = useCallback((name: RouteName, params?: Record<string, unknown>) => {
    setStack((s) => [...s.slice(0, -1), { name, params }]);
  }, []);
  const back = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  const toast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  }, []);

  const fail = useCallback(
    (e: unknown) => {
      sfx.play('error');
      toast(e instanceof ApiError || e instanceof Error ? e.message : String(e), 'bad');
    },
    [toast],
  );

  const refreshHome = useCallback(async () => {
    try {
      const h = await api.get<HomeDTO>('/home');
      if (h.general) h.general.portraitUrl = api.asset(h.general.portraitUrl);
      api.playerId = h.player.id;
      setHome(h);
      setCourier(false);
      void prefs.set(HOME_CACHE, JSON.stringify(h));
      return h;
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) {
        // Courier delayed: render from cache (§11 screen 03 fallback).
        setCourier(true);
        const cached = await prefs.get(HOME_CACHE);
        if (cached) {
          const h = JSON.parse(cached) as HomeDTO;
          setHome(h);
          return h;
        }
      }
      if (e instanceof ApiError && e.status === 401) {
        await api.setSession(null, null);
        setStack([{ name: 'signin' }]);
      }
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.setSession(null, null);
    await prefs.remove(HOME_CACHE);
    setHome(null);
    setStack([{ name: 'signin' }]);
  }, []);

  // Android back button → router (§17.5).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sub = CapApp.addListener('backButton', () => {
      setStack((s) => {
        const top = s[s.length - 1]!.name;
        if (top === 'battle' || s.length <= 1 || top === 'home') return s;
        return s.slice(0, -1);
      });
    });
    return () => void sub.then((x) => x.remove());
  }, []);

  const value = useMemo<Store>(
    () => ({
      route,
      go,
      replace,
      back,
      mode,
      setMode,
      home,
      refreshHome,
      courierDelayed,
      toast,
      toasts,
      battle,
      setBattle,
      generalSprite,
      setGeneralSprite,
      signOut,
      fail,
    }),
    [route, go, replace, back, mode, home, refreshHome, courierDelayed, toast, toasts, battle, generalSprite, signOut, fail],
  );
  // Expose a reset for "boot" to route after init.
  (value as Store & { reset?: (r: Route) => void }).reset = (r: Route) => setStack([r]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useReset() {
  const s = useStore() as Store & { reset: (r: Route) => void };
  return s.reset;
}
