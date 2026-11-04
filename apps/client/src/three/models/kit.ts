import * as THREE from 'three';

/**
 * Shared building blocks for the code-built 3D models (spec F6): cartoon (toon) shading with a
 * 3-step ramp, a dark "inverted hull" outline for readable silhouettes at small size, and a few
 * primitive helpers. No downloaded models or textures: every mesh is made here.
 */

let ramp: THREE.DataTexture | null = null;
function toonRamp() {
  if (ramp) return ramp;
  ramp = new THREE.DataTexture(new Uint8Array([110, 110, 110, 255, 190, 190, 190, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

const cache = new Map<string, THREE.Material>();

/** Cartoon material (optionally glowing). Shared per colour. */
export function toon(color: string, emissive?: string): THREE.MeshToonMaterial {
  const key = `t|${color}|${emissive ?? ''}`;
  let m = cache.get(key) as THREE.MeshToonMaterial | undefined;
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
    if (emissive) {
      m.emissive = new THREE.Color(emissive);
      m.emissiveIntensity = 1;
    }
    cache.set(key, m);
  }
  return m;
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: '#1a1208', side: THREE.BackSide });
const SHADOW = new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.28, depthWrite: false });

/** Outline thickness in world units (tiles): about 1.4 px in the baked sprites. */
export const OUTLINE_WIDTH = 0.022;

/**
 * A mesh with its outline shell: the same geometry, drawn back-faces only, grown by a fixed
 * OUTLINE_WIDTH (not a fixed ratio, so small parts get a visible line too). `outline` ≤ 1
 * turns the shell off; a value > 1 scales the width.
 */
export function part(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, outline = 1.07): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.add(new THREE.Mesh(geo, m));
  if (outline > 1) {
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const r = Math.max(0.01, geo.boundingSphere!.radius);
    const w = OUTLINE_WIDTH * (outline >= 1.1 ? 1.5 : 1);
    const shell = new THREE.Mesh(geo, OUTLINE);
    shell.scale.setScalar((r + w) / r);
    g.add(shell);
  }
  return g;
}

/** A joint: an empty group at a pivot, so a limb can swing about it. */
export function joint(parent: THREE.Object3D, x: number, y: number, z: number) {
  const j = new THREE.Group();
  j.position.set(x, y, z);
  parent.add(j);
  return j;
}

/** Soft blob shadow on the ground under a model (bakes into the sprite). */
export function blobShadow(radius: number, stretch = 1) {
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), SHADOW);
  m.rotation.x = -Math.PI / 2;
  m.scale.set(1, stretch, 1);
  m.position.y = 0.005;
  m.renderOrder = -1;
  return m;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
export const ball = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
export const cyl = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
export const cone = (r: number, h: number, seg = 8) => new THREE.ConeGeometry(r, h, seg);

/** Free GPU buffers of a model tree (materials are shared and kept). */
export function disposeModel(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}

/** Ease helpers for the procedural animation. */
export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
export const easeIn = (t: number) => t * t;
