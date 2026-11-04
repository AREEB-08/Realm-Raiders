// Reused from web-coc (src/game/render-interpolation.ts) under the owner's code licence — see LICENSES/README.md.
/** Anything the presentation draws at a simulated position. */
export interface Positioned {
  id: number;
  x: number;
  y: number;
}
/** The moving parts of a battle the presentation interpolates. */
export interface InterpolatedBattle {
  units: Positioned[];
  defenders?: Positioned[];
}
type Point = { x: number; y: number };

/** A step longer than this (tiles) is a teleport: recall, revive, spawn, replay seek. */
export const TELEPORT_TILES = 1.5;

interface Shift {
  x: number;
  y: number;
  ix: number;
  iy: number;
}
const positionKey = (x: number, y: number) => x * 8191.7 + y;

/**
 * Render interpolation between fixed simulation ticks.
 *
 * The simulation advances in 50 ms steps; drawing its raw state on a 60 Hz or faster display
 * judders. `capture` records every unit's and defender's position right before each step, and
 * `prepare` computes, for the current frame, where each one is drawn:
 * `previous + (current - previous) * alpha`.
 *
 * Nothing is written back to the battle. Presentations receive `project` in place of `iso`: it
 * maps a unit's *simulated* map position to the screen point of its interpolated position (and
 * any other point, such as a building's, exactly like `iso`). So everything that reads unit
 * state (walk-state tracking, facing, targeting, recordings, replays) still sees simulation
 * values, and only the final screen placement moves smoothly.
 */
export class RenderInterpolation {
  private battle: unknown = null;
  private units = new Map<number, Point>();
  private defenders = new Map<number, Point>();
  private shifts = new Map<number, Shift>();
  /** Shift records reused frame to frame (no per-unit allocation per frame). */
  private spare: Shift[] = [];
  private used = 0;
  private lastHash = NaN;
  /** Whether the last `prepare` produced positions different from the one before it. */
  moved = true;

  constructor(private toScreen: (x: number, y: number, out: Point) => Point) {}

  /** Record positions before a simulation step. */
  capture(battle: InterpolatedBattle | null) {
    if (battle !== this.battle) this.reset(battle);
    if (!battle) return;
    record(this.units, battle.units);
    if (battle.defenders) record(this.defenders, battle.defenders);
  }

  /** Compute this frame's interpolated positions; `alpha` is the fraction of the next tick. */
  prepare(battle: InterpolatedBattle | null, alpha: number) {
    if (battle !== this.battle) this.reset(battle);
    this.shifts.clear();
    this.used = 0;
    if (!battle) {
      this.moved = this.lastHash !== 0;
      this.lastHash = 0;
      return;
    }
    const t = Math.max(0, Math.min(1, alpha));
    let hash = battle.units.length * 7 + (battle.defenders?.length ?? 0) * 13;
    hash = this.interpolate(battle.units, this.units, t, hash);
    if (battle.defenders) hash = this.interpolate(battle.defenders, this.defenders, t, hash);
    this.moved = hash !== this.lastHash;
    this.lastHash = hash;
  }

  /** Drop this frame's shifts: `project` becomes plain `iso` (direct, uninterpolated draws). */
  disable() {
    this.shifts.clear();
    this.moved = true;
    this.lastHash = NaN;
  }

  /** Screen point for a simulated map position, interpolated if a unit stands exactly there. */
  projectInto<T extends Point>(out: T, x: number, y: number): T {
    const shift = this.shifts.size ? this.shifts.get(positionKey(x, y)) : undefined;
    if (shift && shift.x === x && shift.y === y) this.toScreen(shift.ix, shift.iy, out);
    else this.toScreen(x, y, out);
    return out;
  }

  /** Forget history (new battle object, replay seek, battle over). */
  reset(battle: unknown = null) {
    this.battle = battle;
    this.units.clear();
    this.defenders.clear();
    this.shifts.clear();
    this.lastHash = NaN;
    this.moved = true;
  }

  private interpolate(list: Positioned[], previous: Map<number, Point>, t: number, hash: number) {
    for (const item of list) {
      const from = previous.get(item.id);
      let x = item.x,
        y = item.y;
      if (from && t < 1) {
        const dx = x - from.x,
          dy = y - from.y;
        if ((dx !== 0 || dy !== 0) && dx * dx + dy * dy <= TELEPORT_TILES * TELEPORT_TILES) {
          x = from.x + dx * t;
          y = from.y + dy * t;
          const shift = (this.spare[this.used++] ??= { x: 0, y: 0, ix: 0, iy: 0 });
          shift.x = item.x;
          shift.y = item.y;
          shift.ix = x;
          shift.iy = y;
          this.shifts.set(positionKey(item.x, item.y), shift);
        }
      }
      hash = (hash * 31 + x * 1009 + y * 9176 + item.id) % 1e15;
    }
    return hash;
  }
}

function record(target: Map<number, Point>, list: Positioned[]) {
  for (const item of list) {
    const entry = target.get(item.id);
    if (entry) {
      entry.x = item.x;
      entry.y = item.y;
    } else target.set(item.id, { x: item.x, y: item.y });
  }
  // Units only leave (recall, cleanup); drop their history so the map cannot grow unbounded.
  if (target.size > list.length * 2 + 64) {
    const live = new Set<number>();
    for (const item of list) live.add(item.id);
    for (const id of target.keys()) if (!live.has(id)) target.delete(id);
  }
}
