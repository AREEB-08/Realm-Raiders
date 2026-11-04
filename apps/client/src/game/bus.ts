import type { BattleInput, BattleResult, SimEvent } from '@realm/battle-engine';
import type { BuildingId, Layout, TroopId } from '@realm/game-data';

/** Snapshot the battle HUD reads (~5 per second). */
export interface BattleSnapshot {
  tick: number;
  secondsLeft: number;
  destructionPct: number;
  stars: number;
  remaining: Partial<Record<TroopId, number>>;
  alive: number;
  generalAlive: boolean;
  rallyReady: boolean;
  rallyActive: boolean;
  events: SimEvent[];
  ended: boolean;
}

/** Phaser → React events (the only channel between the two, §19 Phase 2). */
export interface GameEvents {
  ready: void;
  'building-tap': { id: string; sx: number; sy: number };
  'building-select': { id: string | null };
  collect: { id: string; sx: number; sy: number };
  'layout-change': { layout: Layout; movedId: string };
  'layout-invalid': { reason: string };
  place: { type: BuildingId; x: number; y: number };
  /** Placing: the player tapped where the ghost should stand. */
  'place-move': { x: number; y: number };
  /** Wall tool: the line the player drew (or tapped). React plans it and shows Confirm/Cancel. */
  'wall-line': { tiles: { x: number; y: number }[] };
  'battle-tick': BattleSnapshot;
  'battle-end': { result: BattleResult; input: BattleInput };
  'deploy-fail': { reason: string };
  'deploy-ok': { troop: TroopId };
}

type Handler<T> = (payload: T) => void;

class Bus {
  private handlers = new Map<keyof GameEvents, Set<Handler<never>>>();
  on<K extends keyof GameEvents>(event: K, cb: Handler<GameEvents[K]>) {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(cb as Handler<never>);
    return () => set!.delete(cb as Handler<never>);
  }
  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]) {
    for (const cb of this.handlers.get(event) ?? []) (cb as Handler<GameEvents[K]>)(payload);
  }
}

export const bus = new Bus();
