// Reused from web-coc (src/game/pan-fling.ts) under the owner's code licence — see LICENSES/README.md.
/**
 * Camera momentum after a touch pan. The finger's speed over the last moments of the drag
 * carries on after release and decays exponentially, as phones scroll. Positions are CSS
 * pixels of finger travel; the scene converts the displacement into camera scroll.
 *
 * Presentation only: the camera never enters saves, simulation or replays.
 */
export class PanFling {
  /** Release velocity is measured over this much of the end of the drag. */
  static readonly WINDOW_MS = 100;
  /** A finger that rested this long before lifting meant to stop. */
  static readonly REST_MS = 50;
  /** CSS px per ms: slower releases stop where they are; faster ones are capped. */
  static readonly MIN_SPEED = 0.25;
  static readonly MAX_SPEED = 4;
  static readonly STOP_SPEED = 0.02;
  /** Exponential decay: a release at v travels v × TIME_CONSTANT_MS in all. */
  static readonly TIME_CONSTANT_MS = 325;

  private samples: { x: number; y: number; t: number }[] = [];
  private vx = 0;
  private vy = 0;

  get active() {
    return this.vx !== 0 || this.vy !== 0;
  }

  /** The finger's position during a pan (CSS px) at time `t` (ms). */
  track(x: number, y: number, t: number) {
    this.samples.push({ x, y, t });
    while (this.samples.length > 2 && t - this.samples[0].t > PanFling.WINDOW_MS)
      this.samples.shift();
  }

  /** Starts the glide from the tracked release velocity; false when there is none. */
  release(t: number) {
    const samples = this.samples.filter((s) => t - s.t <= PanFling.WINDOW_MS);
    this.stop();
    const first = samples[0],
      last = samples.at(-1);
    if (!first || !last || last.t <= first.t || t - last.t > PanFling.REST_MS) return false;
    let vx = (last.x - first.x) / (last.t - first.t),
      vy = (last.y - first.y) / (last.t - first.t);
    const speed = Math.hypot(vx, vy);
    if (speed < PanFling.MIN_SPEED) return false;
    if (speed > PanFling.MAX_SPEED) {
      vx *= PanFling.MAX_SPEED / speed;
      vy *= PanFling.MAX_SPEED / speed;
    }
    this.vx = vx;
    this.vy = vy;
    return true;
  }

  /**
   * Finger-direction travel (CSS px) over the next `dt` ms. The decay is integrated exactly,
   * so the glide covers the same distance at 30 FPS (battery saver) as at 60 or 120.
   */
  step(dt: number) {
    if (!this.active || !(dt > 0)) return { x: 0, y: 0 };
    const decay = Math.exp(-dt / PanFling.TIME_CONSTANT_MS);
    const travel = PanFling.TIME_CONSTANT_MS * (1 - decay);
    const moved = { x: this.vx * travel, y: this.vy * travel };
    this.vx *= decay;
    this.vy *= decay;
    if (Math.hypot(this.vx, this.vy) < PanFling.STOP_SPEED) this.vx = this.vy = 0;
    return moved;
  }

  stop() {
    this.samples = [];
    this.vx = this.vy = 0;
  }
}
