import Phaser from 'phaser';
import { BUILDINGS, GRID, type BuildingId } from '@realm/game-data';
import { paintBuilding, paintIsland, paintRubble, type BuildingArt } from './art';
import { buildForest } from './forest';
import { bakedBuilding } from './bakedBuildings';
import { TH, TW, iso, uniso } from './iso';
import {
  approach,
  clampScroll,
  clampZoom,
  doubleTapZoom,
  fitScale,
  isDoubleTap,
  screenOf,
  scrollToPin,
  wheelFactor,
  worldAt,
  zoomAbout,
  type Bounds,
} from './render/camera-math';
import { PanFling } from './render/pan-fling';

export type Look = 'day' | 'night' | 'dawn';

/** Register a canvas-painted texture once per game. */
export function ensureTexture(scene: Phaser.Scene, key: string, paint: () => HTMLCanvasElement) {
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, paint());
  return key;
}

const artCache = new Map<string, BuildingArt>();
/**
 * A building's texture: the baked 3D sprite when the baker is ready, else the 2D drawing.
 * `scale` must be applied by the caller (3D sprites are baked at a higher resolution).
 */
export function buildingTexture(scene: Phaser.Scene, type: BuildingId, level: number, banner: string) {
  const b3 = bakedBuilding(type, level, banner);
  if (b3) {
    const key3 = `b3d:${type}:${level}:${banner}`;
    if (!scene.textures.exists(key3)) scene.textures.addCanvas(key3, b3.canvas);
    return { key: key3, originX: b3.originX, originY: b3.originY, scale: b3.scale };
  }
  const key = `b:${type}:${level}:${banner}`;
  let art = artCache.get(key);
  if (!art) {
    art = paintBuilding(type, level, banner);
    artCache.set(key, art);
  }
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, art.canvas);
  return { key, originX: art.originX, originY: art.originY, scale: 1 };
}

export function rubbleTexture(scene: Phaser.Scene, size: number) {
  const key = `rubble:${size}`;
  let art = artCache.get(key);
  if (!art) {
    art = paintRubble(size);
    artCache.set(key, art);
  }
  if (!scene.textures.exists(key)) scene.textures.addCanvas(key, art.canvas);
  return { key, originX: art.originX, originY: art.originY };
}

type Gesture = 'none' | 'pan' | 'claimed';

/** Deep forest behind everything (only seen beyond the painted forest floor, far zoomed out). */
const FOREST_BG: Record<Look, string> = {
  day: 'radial-gradient(120% 120% at 50% 45%, #2f6a36 0%, #1d4526 55%, #10261a 100%)',
  night: 'radial-gradient(120% 120% at 50% 45%, #1a2a4a 0%, #0e1830 60%, #070b1c 100%)',
  dawn: 'radial-gradient(120% 120% at 50% 45%, #5a5a3a 0%, #2c3a2a 55%, #16201a 100%)',
};

/** Graphics point lists only read x/y; plain objects are fine at runtime. */
export const pts = (p: { x: number; y: number }[]) => p as unknown as Phaser.Math.Vector2[];

/** Phaser 4 tint helpers: fill-flash and back to the normal multiply tint. */
export function flash(s: Phaser.GameObjects.Image) {
  s.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
}
export function unflash(s: Phaser.GameObjects.Image) {
  s.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
}

/** The island diamond plus room for tall buildings: what "1× = fit" frames. */
const ISLAND_BOX = { w: GRID * TW + 120, h: GRID * TH + 240 };
/** How far past the island the camera may roam (the forest border). */
const BORDER = 760;
const top0 = iso(0, 0);
const BOUNDS: Bounds = {
  minX: top0.x - (GRID * TW) / 2 - BORDER,
  maxX: top0.x + (GRID * TW) / 2 + BORDER,
  minY: top0.y - BORDER * 0.7,
  maxY: top0.y + GRID * TH + BORDER * 0.7,
};

/**
 * Shared island stage: ground, waves, and the camera/input stack (spec F3).
 * - Zoom 0.6×–2.5× where 1× fits the island; smooth (lerped) for the wheel, buttons and
 *   double-tap; pinch follows the fingers exactly (zoom about their midpoint and pan with it).
 * - One-finger drag pans with fling momentum; the camera stays on the map + forest border.
 * - Subclasses claim drags (draw walls, move a picked-up building, stream troops) and taps.
 * The maths lives in `render/camera-math.ts` (unit-tested).
 */
export abstract class IsoScene extends Phaser.Scene {
  protected look: Look = 'day';
  protected ground?: Phaser.GameObjects.Image;
  private forest: Phaser.GameObjects.GameObject[] = [];
  /** View zoom (1 = island fits) and where the smoothing is heading. */
  protected viewZoom = 1;
  private zoomTarget = 1;
  private zoomAnchor: { x: number; y: number } | null = null;
  protected fling = new PanFling();
  private flingFrom: { x: number; y: number; t: number } | null = null;
  protected down: { x: number; y: number; t: number; cx: number; cy: number } | null = null;
  protected gesture: Gesture = 'none';
  private pinch: { d0: number; z0: number; pin: { x: number; y: number } } | null = null;
  protected pinching = false;
  private lastTap: { t: number; x: number; y: number } | null = null;
  /** World point at the screen centre, kept current so a resize/rotation re-centres on it. */
  private centre: { x: number; y: number } | null = null;

  protected get density() {
    const rect = this.game.canvas.getBoundingClientRect();
    return rect.width > 0 ? this.scale.width / rect.width : 1;
  }

  private get camView() {
    const cam = this.cameras.main;
    return { w: cam.width, h: cam.height };
  }

  /** Canvas-pixel scale at which the island fits the current screen (portrait or landscape). */
  private get baseScale() {
    return fitScale(this.camView, ISLAND_BOX);
  }

  protected buildStage(look: Look) {
    this.look = look;
    // Deep forest is a CSS gradient behind the transparent canvas; the painted forest (floor,
    // path, trees) sits in the world around the island. React owns the stage's className.
    this.game.canvas.style.background = FOREST_BG[look];
    for (const o of this.forest) o.destroy();
    this.forest = buildForest(this, look, BOUNDS);
    const islandKey = `island:${look}`;
    let origin = { ox: 0.5, oy: 0 };
    if (!this.textures.exists(islandKey)) {
      const art = paintIsland(look);
      this.textures.addCanvas(islandKey, art.canvas);
      origin = { ox: art.ox, oy: art.oy };
      this.registry.set(`${islandKey}:origin`, origin);
    } else origin = this.registry.get(`${islandKey}:origin`) ?? origin;
    this.ground?.destroy();
    const top = iso(0, 0);
    this.ground = this.add.image(top.x, top.y, islandKey).setOrigin(origin.ox, origin.oy).setDepth(-800);
    this.scale.off('resize', this.onResize, this);
    this.scale.on('resize', this.onResize, this);
    this.events.once('shutdown', () => {
      this.scale.off('resize', this.onResize, this);
      this.forest = [];
    });
  }

  private onResize() {
    // A stopped scene keeps no camera; its listener is removed on shutdown, but guard anyway.
    if (!this.sys.isActive() || !this.cameras?.main) return;
    // Rotation or a new window size: Phaser keeps scrollX/Y (the top-left), so re-centre on the
    // world point that was in the middle before, at the same view zoom.
    const c = this.centre ?? iso(GRID / 2, GRID / 2);
    this.applyZoom(this.viewZoom);
    this.cameras.main.centerOn(c.x, c.y);
    this.clampCamera();
  }

  /** Frame the island (or a focus point) at a view zoom (1 = the island fits). */
  protected frameCamera(focus?: { x: number; y: number }, zoom = 1) {
    if (!this.cameras?.main) return;
    this.applyZoom(zoom);
    this.zoomTarget = this.viewZoom;
    this.zoomAnchor = null;
    const c = focus ?? iso(GRID / 2, GRID / 2);
    this.cameras.main.centerOn(c.x, c.y - 30);
    this.clampCamera();
    this.centre = { x: c.x, y: c.y - 30 };
  }

  /**
   * Frame the base itself (its buildings plus room for their height), not the whole island:
   * the island is 30 tiles of mostly grass, so fitting it left buildings and troops tiny.
   */
  protected frameBase(blds: { x: number; y: number; size: number }[], boost = 1) {
    if (!blds.length) return this.frameCamera(undefined, boost);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const b of blds) {
      for (const [tx, ty] of [
        [b.x, b.y],
        [b.x + b.size, b.y],
        [b.x, b.y + b.size],
        [b.x + b.size, b.y + b.size],
      ] as const) {
        const p = iso(tx, ty);
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    minY -= 80; // tall buildings
    const box = { w: maxX - minX + TW * 3, h: maxY - minY + TH * 3 };
    const z = (fitScale(this.camView, box, 0.9) / this.baseScale) * boost;
    this.frameCamera({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 + 30 }, Math.min(2.2, Math.max(1, z)));
  }

  protected applyZoom(viewZoom: number) {
    if (!this.cameras?.main) return;
    this.viewZoom = clampZoom(viewZoom);
    this.cameras.main.setZoom(this.baseScale * this.viewZoom);
  }

  /** Set the view zoom so the content under canvas point `s` stays put. */
  protected setZoomAt(viewZoom: number, s: { x: number; y: number }) {
    const cam = this.cameras.main;
    const from = cam.zoom;
    this.applyZoom(viewZoom);
    const next = zoomAbout({ x: cam.scrollX, y: cam.scrollY }, from, cam.zoom, this.camView, s);
    cam.setScroll(next.x, next.y);
    this.clampCamera();
  }

  /** Smoothly zoom by a factor about a canvas point (default: the screen centre). +/− buttons. */
  zoomBy(factor: number, s?: { x: number; y: number }) {
    if (!this.cameras?.main) return;
    this.fling.stop();
    this.zoomTarget = clampZoom(this.zoomTarget * factor);
    this.zoomAnchor = s ?? { x: this.camView.w / 2, y: this.camView.h / 2 };
  }

  protected clampCamera() {
    const cam = this.cameras.main;
    const c = clampScroll({ x: cam.scrollX, y: cam.scrollY }, cam.zoom, this.camView, BOUNDS);
    cam.setScroll(c.x, c.y);
  }

  /** Test/dev probe: view zoom (1 = the island fits) and tile → page coordinates. */
  probe() {
    const cam = this.cameras.main;
    const rect = this.game.canvas.getBoundingClientRect();
    return {
      zoom: this.viewZoom,
      zoomTarget: this.zoomTarget,
      scroll: { x: cam.scrollX, y: cam.scrollY },
      tileToClient: (tx: number, ty: number) => {
        const s = screenOf({ x: cam.scrollX, y: cam.scrollY }, cam.zoom, this.camView, iso(tx, ty));
        return { x: rect.left + s.x / this.density, y: rect.top + s.y / this.density };
      },
    };
  }

  /** Canvas point → world point and fractional tile, through the camera's own transform. */
  protected tileAt(p: { x: number; y: number }) {
    const cam = this.cameras.main;
    const w = worldAt({ x: cam.scrollX, y: cam.scrollY }, cam.zoom, this.camView, p);
    return { world: w, tile: uniso(w.x, w.y) };
  }

  // ---- hooks -------------------------------------------------------------------
  /** A tap (no drag). Return true when the tap did something (then it never counts toward a double-tap zoom). */
  protected onTap(_p: Phaser.Input.Pointer): boolean | void {}
  /** Return true to take over a drag that starts here (instead of panning). */
  protected claimDrag(_p: Phaser.Input.Pointer): boolean {
    return false;
  }
  protected onDrag(_p: Phaser.Input.Pointer) {}
  protected onDragEnd(_p: Phaser.Input.Pointer, _cancelled: boolean) {}
  /** Called while a finger rests on the canvas without moving (hold). */
  protected onHold(_p: Phaser.Input.Pointer, _heldMs: number) {}
  /** Every finger lift (tap, drag end, cancel). */
  protected onRelease() {}
  protected onPointerMove(_p: Phaser.Input.Pointer) {}

  private startPinch(a: Phaser.Input.Pointer, b: Phaser.Input.Pointer) {
    const cam = this.cameras.main;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    this.pinch = {
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      z0: this.viewZoom,
      pin: worldAt({ x: cam.scrollX, y: cam.scrollY }, cam.zoom, this.camView, mid),
    };
    this.zoomAnchor = null;
  }

  protected setupInput() {
    this.input.addPointer(2);
    const pointers = () => this.input.manager.pointers.filter((v) => v.isDown);
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.fling.stop();
      this.flingFrom = null;
      const down = pointers();
      if (down.length >= 2) {
        if (this.gesture === 'claimed') this.onDragEnd(p, true);
        this.gesture = 'pan';
        this.pinching = true;
        this.startPinch(down[0]!, down[1]!);
        return;
      }
      this.pinching = false;
      this.pinch = null;
      const cam = this.cameras.main;
      this.down = { x: p.x, y: p.y, t: performance.now(), cx: cam.scrollX, cy: cam.scrollY };
      this.gesture = 'none';
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.onPointerMove(p);
      const down = pointers();
      if (down.length >= 2) {
        const [a, b] = down as [Phaser.Input.Pointer, Phaser.Input.Pointer];
        if (!this.pinch) this.startPinch(a, b);
        const pin = this.pinch!;
        // Zoom with the finger spread and pan with their midpoint: the world point that was under
        // the midpoint when the pinch began stays under it.
        const z = clampZoom((pin.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / pin.d0);
        this.applyZoom(z);
        this.zoomTarget = this.viewZoom;
        const cam = this.cameras.main;
        const next = scrollToPin(pin.pin, cam.zoom, this.camView, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        cam.setScroll(next.x, next.y);
        this.clampCamera();
        this.gesture = 'pan';
        this.pinching = true;
        return;
      }
      this.pinch = null;
      if (!p.isDown || !this.down) return;
      const dx = p.x - this.down.x;
      const dy = p.y - this.down.y;
      const travel = Math.hypot(dx, dy) / this.density;
      if (this.gesture === 'none' && travel > 7) this.gesture = this.claimDrag(p) ? 'claimed' : 'pan';
      if (this.gesture === 'claimed') this.onDrag(p);
      else if (this.gesture === 'pan' && !this.pinching) {
        const cam = this.cameras.main;
        cam.setScroll(this.down.cx - dx / cam.zoom, this.down.cy - dy / cam.zoom);
        this.clampCamera();
        this.fling.track(p.x / this.density, p.y / this.density, performance.now());
      }
    });
    const up = (p: Phaser.Input.Pointer, cancelled = false) => {
      const left = pointers().filter((x) => x !== p);
      if (this.pinching && left.length === 1 && !cancelled) {
        const r = left[0]!;
        const cam = this.cameras.main;
        this.pinch = null;
        this.pinching = false;
        this.gesture = 'pan';
        this.down = { x: r.x, y: r.y, t: performance.now(), cx: cam.scrollX, cy: cam.scrollY };
        this.fling.stop();
        return;
      }
      this.pinch = null;
      const g = this.gesture;
      this.gesture = 'none';
      const down = this.down;
      this.down = null;
      if (g === 'claimed') this.onDragEnd(p, cancelled);
      else if (g === 'pan' && !this.pinching && !cancelled && this.fling.release(performance.now())) {
        const cam = this.cameras.main;
        this.flingFrom = { x: cam.scrollX, y: cam.scrollY, t: performance.now() };
      } else this.fling.stop();
      if (pointers().length === 0) this.pinching = false;
      if (!cancelled && g === 'none' && down) {
        const now = performance.now();
        const cx = p.x / this.density;
        const cy = p.y / this.density;
        const used = this.onTap(p) === true;
        if (!used && isDoubleTap(this.lastTap, now, cx, cy)) {
          this.lastTap = null;
          this.fling.stop();
          this.zoomTarget = doubleTapZoom(this.viewZoom);
          this.zoomAnchor = { x: p.x, y: p.y };
        } else this.lastTap = used ? null : { t: now, x: cx, y: cy };
      }
      this.onRelease();
    };
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => up(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => up(p, true));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (!dy) return;
      this.zoomBy(wheelFactor(dy), { x: p.x, y: p.y });
    });
    const cancel = () => {
      this.fling.stop();
      if (this.gesture === 'claimed' && this.input.activePointer) this.onDragEnd(this.input.activePointer, true);
      this.down = null;
      this.gesture = 'none';
      this.pinch = null;
      this.onRelease();
    };
    window.addEventListener('blur', cancel);
    this.events.once('shutdown', () => window.removeEventListener('blur', cancel));
  }

  protected stepCamera(delta: number) {
    // Smooth zoom (wheel, +/−, double-tap) toward the target about its anchor.
    if (this.viewZoom !== this.zoomTarget && !this.pinching) {
      const z = approach(this.viewZoom, this.zoomTarget, delta);
      const v = this.camView;
      this.setZoomAt(z, this.zoomAnchor ?? { x: v.w / 2, y: v.h / 2 });
    }
    // Fling momentum (finger-direction CSS px → world).
    if (this.fling.active && this.flingFrom) {
      const m = this.fling.step(delta);
      const cam = this.cameras.main;
      cam.setScroll(cam.scrollX - (m.x * this.density) / cam.zoom, cam.scrollY - (m.y * this.density) / cam.zoom);
      this.clampCamera();
    }
    {
      const cam = this.cameras.main;
      const v = this.camView;
      this.centre = worldAt({ x: cam.scrollX, y: cam.scrollY }, cam.zoom, v, { x: v.w / 2, y: v.h / 2 });
    }
    // Hold detection.
    const p = this.input.activePointer;
    if (p?.isDown && this.down && this.gesture === 'none' && !this.pinching) {
      const held = performance.now() - this.down.t;
      if (held > 220) this.onHold(p, held);
    }
  }

  protected footprintOf(type: BuildingId, x: number, y: number): Phaser.Math.Vector2[] {
    const s = BUILDINGS[type].size;
    return pts([iso(x, y), iso(x + s, y), iso(x + s, y + s), iso(x, y + s)]);
  }
}
