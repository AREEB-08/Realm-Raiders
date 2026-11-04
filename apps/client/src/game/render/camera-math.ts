/**
 * Pure camera maths for the island, build and battle views (spec F3). No Phaser here, so every
 * rule is unit-tested: zoom range, zoom about a point, clamping, smoothing, double-tap.
 *
 * Units: "view zoom" `z` is relative to the fit — 1 means the whole island fits the screen; the
 * player can go from 0.6× (more forest around it) to 2.5× (close-up). The Phaser camera zoom is
 * `fit × z × density`. Screen points are canvas pixels; Phaser's camera maps
 * `screen = w/2 + zoom × (world − scroll − w/2)`.
 */

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.5;
/** One +/− button press. */
export const ZOOM_STEP = 1.35;

export interface View {
  /** Canvas size in canvas pixels. */
  w: number;
  h: number;
}
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}
export interface Point {
  x: number;
  y: number;
}

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number.isFinite(z) ? z : 1));

/** Scale at which a `content` box fits inside the view, with a small margin. */
export function fitScale(view: View, content: { w: number; h: number }, margin = 0.92) {
  return Math.max(1e-3, Math.min(view.w / content.w, view.h / content.h) * margin);
}

/** World point under a screen point. */
export function worldAt(scroll: Point, scale: number, view: View, s: Point): Point {
  return { x: scroll.x + view.w / 2 + (s.x - view.w / 2) / scale, y: scroll.y + view.h / 2 + (s.y - view.h / 2) / scale };
}

/** Screen point of a world point. */
export function screenOf(scroll: Point, scale: number, view: View, w: Point): Point {
  return { x: view.w / 2 + scale * (w.x - scroll.x - view.w / 2), y: view.h / 2 + scale * (w.y - scroll.y - view.h / 2) };
}

/** Scroll that puts world point `w` under screen point `s` at `scale` (zoom about a point, pinch). */
export function scrollToPin(w: Point, scale: number, view: View, s: Point): Point {
  return { x: w.x - view.w / 2 - (s.x - view.w / 2) / scale, y: w.y - view.h / 2 - (s.y - view.h / 2) / scale };
}

/** Change scale while the content under screen point `s` stays put. */
export function zoomAbout(scroll: Point, from: number, to: number, view: View, s: Point): Point {
  return scrollToPin(worldAt(scroll, from, view, s), to, view, s);
}

/**
 * Keep the view on the map + forest border. When the view is wider (or taller) than the bounds,
 * the bounds are centred instead.
 */
export function clampScroll(scroll: Point, scale: number, view: View, b: Bounds): Point {
  const vw = view.w / scale;
  const vh = view.h / scale;
  // Visible world rect = [scroll + w/2 − vw/2, … + vw]: work in terms of its left/top edge.
  const left = scroll.x + view.w / 2 - vw / 2;
  const top = scroll.y + view.h / 2 - vh / 2;
  const nl = vw >= b.maxX - b.minX ? (b.minX + b.maxX) / 2 - vw / 2 : Math.min(b.maxX - vw, Math.max(b.minX, left));
  const nt = vh >= b.maxY - b.minY ? (b.minY + b.maxY) / 2 - vh / 2 : Math.min(b.maxY - vh, Math.max(b.minY, top));
  return { x: nl - view.w / 2 + vw / 2, y: nt - view.h / 2 + vh / 2 };
}

/**
 * Frame-rate independent smoothing toward a target (exponential; `halfLifeMs` = time to cover
 * half the remaining distance). Snaps when within 0.1%.
 */
export function approach(current: number, target: number, dtMs: number, halfLifeMs = 60) {
  const k = 1 - Math.pow(0.5, Math.max(0, dtMs) / halfLifeMs);
  const next = current + (target - current) * k;
  return Math.abs(target - next) <= Math.abs(target) * 1e-3 ? target : next;
}

/** Double-tap: zoom in (×2, capped) — or back to the fit when already close in. */
export const doubleTapZoom = (z: number) => (z >= 1.9 ? 1 : clampZoom(Math.max(z * 2, 1.6)));

/** Wheel notch → zoom factor (trackpads send small deltas, mice ~100 per notch). */
export const wheelFactor = (deltaY: number) => Math.min(1.5, Math.max(0.66, Math.exp(-deltaY * 0.0015)));

/** Two quick taps close together count as a double-tap. */
export function isDoubleTap(prev: { t: number; x: number; y: number } | null, t: number, x: number, y: number, maxMs = 320, maxDist = 36) {
  return !!prev && t - prev.t <= maxMs && Math.hypot(x - prev.x, y - prev.y) <= maxDist;
}
