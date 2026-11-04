import * as THREE from 'three';
import type { BuildingId, TroopId } from '@realm/game-data';
import type { Appearance } from '@realm/shared';
import { disposeModel } from './models/kit';
import { ANCHOR_Y, ANIM_COLS, ANIMS, BAKED_DIRS, GAME_PX_PER_TILE } from './bake-layout';
import { TROOP_FRAME, buildTroop, pose } from './models/troops';

/**
 * Sprite baker (spec F6): renders the code-built 3D models from the battle's isometric camera
 * (elevation 30°, azimuth 45° — the game's 2:1 projection) into sprite atlases that Phaser plays.
 *
 * - Directions: 8 on screen, 5 baked (S, SE, W, NW, N); E, SW and NE are mirror images of W, SE
 *   and NW (an iso screen flip swaps the tile axes).
 * - Animations: idle 4, walk 8, attack 6, death 4 frames (22 columns).
 * - One WebGL renderer the size of the atlas draws every cell through a scissor viewport, then the
 *   atlas is copied once into a 2D canvas (no per-frame readback).
 */
export const ART_VERSION = 2;

export { ANCHOR_Y, ANIM_COLS, ANIM_START, BAKED_DIRS, DIR8, GAME_PX_PER_TILE, dir8Of } from './bake-layout';

const ELEV = Math.PI / 6;
const VIEW = new THREE.Vector3(Math.cos(ELEV) * Math.SQRT1_2, Math.sin(ELEV), Math.cos(ELEV) * Math.SQRT1_2);

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene } | null = null;
function bakeContext() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#56664a', 1.25));
  const key = new THREE.DirectionalLight('#fff3dc', 2.1);
  key.position.set(-1.2, 2.4, 2.2);
  scene.add(key);
  shared = { renderer, scene };
  return shared;
}

/** After the army bake: shrink the bake canvas (the renderer stays for building bakes). */
export function releaseBaker() {
  shared?.renderer.setSize(1, 1, false);
}

function isoCamera(halfW: number, top: number, bottom: number, target = new THREE.Vector3()) {
  const cam = new THREE.OrthographicCamera(-halfW, halfW, top, bottom, 0.1, 60);
  cam.position.copy(target).addScaledVector(VIEW, 25);
  cam.up.set(0, 1, 0);
  cam.lookAt(target);
  cam.updateProjectionMatrix();
  return cam;
}

const nextFrame = () => new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 0)));

export interface TroopAtlas {
  canvas: HTMLCanvasElement;
  size: number;
  /** Display scale that brings the bake back to the game's px-per-tile. */
  display: number;
}

/**
 * Bake one troop's atlas (5 rows × 22 columns). Yields to the browser after each row so the
 * UI stays responsive. Throws if WebGL is unavailable (callers keep the 2D art then).
 */
export async function bakeTroopAtlas(kind: TroopId, appearance?: Appearance, onRow?: () => void): Promise<TroopAtlas> {
  const { renderer, scene } = bakeContext();
  const { size, scale } = TROOP_FRAME[kind];
  const W = ANIM_COLS * size;
  const H = BAKED_DIRS.length * size;
  renderer.setSize(W, H, false);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.setScissorTest(true);
  const rig = buildTroop(kind, appearance);
  scene.add(rig.root);
  const cam = isoCamera(size / 2 / scale, (ANCHOR_Y * size) / scale, (-(1 - ANCHOR_Y) * size) / scale);
  try {
    for (let row = 0; row < BAKED_DIRS.length; row++) {
      const th = (BAKED_DIRS[row]! * Math.PI) / 180;
      rig.root.rotation.y = Math.atan2(Math.cos(th), Math.sin(th));
      let col = 0;
      for (const [anim, n] of ANIMS) {
        for (let i = 0; i < n; i++, col++) {
          pose(rig, anim, anim === 'death' ? i / (n - 1) : i / n);
          const x = col * size;
          const y = H - (row + 1) * size;
          renderer.setViewport(x, y, size, size);
          renderer.setScissor(x, y, size, size);
          renderer.render(scene, cam);
        }
      }
      onRow?.();
      await nextFrame();
    }
  } finally {
    scene.remove(rig.root);
    disposeModel(rig.root);
    renderer.setScissorTest(false);
  }
  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  return { canvas: out, size, display: GAME_PX_PER_TILE / scale };
}

/** Render any model once from the iso camera into a canvas (buildings). */
export function bakeStill(model: THREE.Object3D, w: number, h: number, scale: number, anchor: { x: number; y: number }): HTMLCanvasElement {
  const { renderer, scene } = bakeContext();
  renderer.setScissorTest(false);
  renderer.setSize(w, h, false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  scene.add(model);
  const cam = isoCamera(w / 2 / scale, (anchor.y * h) / scale, (-(1 - anchor.y) * h) / scale);
  cam.left = (-anchor.x * w) / scale;
  cam.right = ((1 - anchor.x) * w) / scale;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  scene.remove(model);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0, w, h, 0, 0, w, h);
  return out;
}


// ---------------------------------------------------------------------- buildings ---

/** Buildings bake at 1.5x the game's px-per-tile and are drawn at 2/3 scale (crisp when zoomed in). */
const BUILDING_RES = 1.5;
type Still = { canvas: HTMLCanvasElement; originX: number; originY: number; scale: number };
const stills = new Map<string, Still>();

/**
 * Returns a baker for building sprites (type x level x banner colour), baked on first use and
 * kept in memory. The footprint centre is the origin, exactly like the 2D painter, so call sites
 * only add the scale.
 */
export async function loadBuildingBaker() {
  const { buildBuilding, BUILDING_HEIGHT } = await import('./models/buildings');
  const { BUILDINGS } = await import('@realm/game-data');
  return (type: BuildingId, level: number, banner: string): Still => {
    const key = `${type}:${level}:${banner}`;
    const hit = stills.get(key);
    if (hit) return hit;
    const s = BUILDINGS[type].size;
    const ppt = GAME_PX_PER_TILE * BUILDING_RES;
    const halfH = s * 16 * BUILDING_RES;
    const W = Math.ceil(s * 64 * BUILDING_RES + 28);
    const model = buildBuilding(type, level, banner);
    // Size the canvas from the model itself (its real height after the footprint fill).
    const tallest = Math.max(BUILDING_HEIGHT[type] * 0.5, new THREE.Box3().setFromObject(model).max.y);
    const top = Math.ceil(halfH + tallest * Math.cos(Math.PI / 6) * ppt + 14);
    const H = Math.ceil(top + halfH + 14);
    try {
      const canvas = bakeStill(model, W, H, ppt, { x: 0.5, y: top / H });
      const out = { canvas, originX: 0.5, originY: top / H, scale: 1 / BUILDING_RES };
      stills.set(key, out);
      return out;
    } finally {
      disposeModel(model);
    }
  };
}

// ---------------------------------------------------------------------- portraits ---

/** A head-and-shoulders 3D portrait (rival lords on the target cards), as a PNG data URL. */
export async function bakePortrait(a: Appearance, size = 160): Promise<string> {
  const { buildGeneral } = await import('./general');
  const { renderer, scene } = bakeContext();
  renderer.setScissorTest(false);
  renderer.setSize(size, size, false);
  renderer.setViewport(0, 0, size, size);
  renderer.clear();
  const rig = buildGeneral(a);
  rig.root.rotation.y = 0.5;
  scene.add(rig.root);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  cam.position.set(0.3, 1.95, 2.3);
  cam.lookAt(0, 1.72, 0);
  renderer.render(scene, cam);
  scene.remove(rig.root);
  disposeModel(rig.root);
  const out = document.createElement('canvas');
  out.width = out.height = size;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0, size, size, 0, 0, size, size);
  return out.toDataURL('image/png');
}
