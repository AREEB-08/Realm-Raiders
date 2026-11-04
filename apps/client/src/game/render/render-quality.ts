// Reused from web-coc (src/game/render-quality.ts) under the owner's code licence — see LICENSES/README.md.
/** Sustained frame pressure lowers only canvas density; CSS layout and world zoom stay fixed. */
export class RenderQuality {
  scale = 1;
  /** The frame interval the loop aims for; a frame cap lengthens it. */
  private interval = 1000 / 60;
  private previous = 0;
  private elapsed = 0;
  private frames = 0;
  private slow = 0;
  private fastFor = 0;
  private settleUntil = 0;

  reset(now: number, settleMs = 5000) {
    this.previous = now;
    this.elapsed = this.frames = this.slow = this.fastFor = 0;
    this.settleUntil = now + settleMs;
  }

  /**
   * Returns true only when a new backbuffer size is needed. Ignore loading, pauses and gaps.
   * `interval` is the loop's target frame time: a deliberate cap (the idle village's) restarts
   * the measurement at its own pace instead of reading as load.
   */
  sample(now: number, enabled: boolean, density: number, interval = 1000 / 60) {
    if (interval !== this.interval) {
      this.interval = interval;
      this.reset(now);
      return false;
    }
    const delta = now - this.previous;
    this.previous = now;
    // Even a renderer below 1 FPS still needs help. Loading/hidden frames are excluded by
    // the caller; reserve the gap reset for a genuine stall or return from a background tab.
    if (!enabled || delta <= 0 || delta > 3000) {
      this.reset(now);
      return false;
    }
    if (now < this.settleUntil) return false;
    // 24 ms slow and 18 ms fast at 60 FPS, in proportion under a cap.
    const pace = this.interval / (1000 / 60);
    this.elapsed += delta;
    this.frames++;
    if (delta > 24 * pace) this.slow++;
    // One long stall is not sustained pressure: wait for a second observed frame.
    if (this.elapsed < 2000 || this.frames < 2) return false;
    const average = this.elapsed / this.frames;
    const pressured = this.slow / this.frames > 0.6;
    this.fastFor = average < 18 * pace ? this.fastFor + this.elapsed : 0;
    // Weak GPUs can be overloaded even at 1×. Keep DOM text at native resolution while the
    // canvas alone can fall to half a pixel per CSS pixel under sustained pressure.
    const minimum = Math.min(1, 0.5 / Math.max(0.5, density));
    // Severe overload needs a useful first reduction on dense phones: halving density
    // removes three quarters of the pixels. Moderate pressure retains the smaller step.
    const reduced = average > this.interval * 3 ? this.scale / 2 : this.scale - 0.25;
    const next = pressured
      ? Math.max(minimum, reduced)
      : this.fastFor >= 15000
        ? Math.min(1, this.scale + 0.25)
        : this.scale;
    this.elapsed = this.frames = this.slow = 0;
    if (next === this.scale) return false;
    this.scale = next;
    this.reset(now);
    return true;
  }
}
