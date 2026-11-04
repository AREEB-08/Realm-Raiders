import * as THREE from 'three';
import type { TroopId } from '@realm/game-data';
import type { Appearance } from '@realm/shared';
import { buildGeneral, type GeneralRig } from '../general';
import { ball, blobShadow, box, cone, cyl, easeIn, easeOut, joint, part, toon } from './kit';

/**
 * Code-built low-poly troops (spec F6): chunky proportions (big heads and hands), bright
 * colours, outlined so they read at 40 px. Each model faces +Z with its feet at y = 0 and
 * 1 unit = 1 battle tile. Animations are procedural poses, sampled by the baker.
 */
import type { Anim } from '../bake-layout';
export type { Anim };

export interface TroopRig {
  kind: TroopId;
  root: THREE.Group;
  body: THREE.Object3D;
  head?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  wingL?: THREE.Object3D;
  wingR?: THREE.Object3D;
  tail?: THREE.Object3D;
  neck?: THREE.Object3D;
  general?: GeneralRig;
}

const SKIN = '#f0c39a';
/** The Fire Dragon flies: its body hangs this high above its shadow. */
const DRAGON_Y = 1.05;

/** Legs on hip joints, boots included. */
function legs(body: THREE.Object3D, color: string, width = 0.12, len = 0.3, spread = 0.11) {
  const mk = (side: number) => {
    const hip = joint(body, side * spread, len, 0);
    hip.add(part(box(width, len, width + 0.02), toon(color), 0, -len / 2, 0));
    hip.add(part(box(width + 0.03, 0.08, width + 0.08), toon('#3a2a1a'), 0, -len + 0.03, 0.03));
    return hip;
  };
  return { legL: mk(1), legR: mk(-1) };
}

/** An arm on a shoulder joint, hanging down, with a big hand at the end. */
function arm(parent: THREE.Object3D, side: number, y: number, color: string, len = 0.3, hand = 0.075, spread = 0.24) {
  const sh = joint(parent, side * spread, y, 0);
  sh.add(part(cyl(0.06, 0.055, len, 6), toon(color), 0, -len / 2, 0));
  sh.add(part(ball(hand, 0), toon(SKIN), 0, -len - 0.02, 0));
  const grip = joint(sh, 0, -len - 0.02, 0.02);
  return { sh, grip };
}

function humanoid(kind: TroopId, c: { body: string; trim: string; legs: string }, scale = 1): TroopRig & { gripR: THREE.Object3D; gripL: THREE.Object3D } {
  const root = new THREE.Group();
  root.add(blobShadow(0.32 * scale));
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const { legL, legR } = legs(body, c.legs);
  const torso = part(cyl(0.2, 0.17, 0.34, 7), toon(c.body), 0, 0.47, 0);
  body.add(torso);
  body.add(part(box(0.36, 0.06, 0.3), toon(c.trim), 0, 0.33, 0, 1.04));
  const head = joint(body, 0, 0.66, 0);
  head.add(part(ball(0.17, 1), toon(SKIN), 0, 0.12, 0));
  for (const s of [-1, 1]) head.add(part(ball(0.025, 0), toon('#1a1208'), s * 0.06, 0.15, 0.155, 1));
  const a1 = arm(body, 1, 0.6, c.body);
  const a2 = arm(body, -1, 0.6, c.body);
  return { kind, root, body, head, armL: a1.sh, armR: a2.sh, legL, legR, gripL: a1.grip, gripR: a2.grip };
}

function swordsman(): TroopRig {
  const r = humanoid('shield', { body: '#3f7fd0', trim: '#d9573f', legs: '#5a4630' });
  r.head!.add(part(new THREE.SphereGeometry(0.185, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2), toon('#b8c0c8'), 0, 0.14, 0));
  r.head!.add(part(box(0.04, 0.12, 0.05), toon('#b8c0c8'), 0, 0.1, 0.17, 1.04));
  // sword (right) and buckler (left)
  r.gripR.add(part(box(0.05, 0.5, 0.02), toon('#eef2f5'), 0, 0.3, 0.05));
  r.gripR.add(part(box(0.18, 0.04, 0.05), toon('#e8c35a'), 0, 0.06, 0.05));
  const buckler = part(cyl(0.16, 0.16, 0.04, 10), toon('#d9573f'), 0.02, 0.02, 0.06);
  buckler.rotation.x = Math.PI / 2;
  buckler.add(part(ball(0.05, 0), toon('#e8c35a'), 0, 0.03, 0, 1));
  r.gripL.add(buckler);
  return r;
}

function archer(): TroopRig {
  const r = humanoid('longbow', { body: '#4f9a3a', trim: '#8b6a3c', legs: '#4a3a24' });
  r.head!.add(part(cone(0.21, 0.32, 8), toon('#3f8a32'), 0, 0.24, -0.02));
  const bow = part(new THREE.TorusGeometry(0.28, 0.025, 4, 12, Math.PI), toon('#8b5a2a'), 0, 0.05, 0.06);
  bow.rotation.set(0, Math.PI / 2, Math.PI / 2);
  r.gripL.add(bow);
  const quiver = part(cyl(0.06, 0.06, 0.32, 6), toon('#7a4a24'), 0.1, 0.55, -0.18);
  quiver.rotation.z = 0.3;
  r.body.add(quiver);
  return r;
}

function sapper(): TroopRig {
  const r = humanoid('sapper', { body: '#7a5634', trim: '#3a2a1a', legs: '#3a2a1a' });
  r.head!.add(part(cyl(0.19, 0.19, 0.06, 8), toon('#3a2a1a'), 0, 0.2, 0));
  const keg = part(ball(0.2, 1), toon('#2a2a2e'), 0, 0.08, 0.16);
  keg.add(part(cyl(0.015, 0.015, 0.14, 4), toon('#b07d3c'), 0, 0.2, 0, 1));
  keg.add(part(ball(0.05, 0), toon('#ffcf5a', '#ff9a2a'), 0, 0.28, 0, 1));
  r.gripR.add(keg);
  return r;
}

function stoneGiant(): TroopRig {
  const root = new THREE.Group();
  root.add(blobShadow(0.62));
  const body = new THREE.Group();
  root.add(body);
  const stone = toon('#8b949c');
  const dark = toon('#5f676e');
  const moss = toon('#5fa046');
  const mk = (side: number) => {
    const hip = joint(body, side * 0.2, 0.42, 0);
    hip.add(part(box(0.22, 0.42, 0.24), dark, 0, -0.21, 0));
    return hip;
  };
  const legL = mk(1);
  const legR = mk(-1);
  body.add(part(new THREE.DodecahedronGeometry(0.42, 0), stone, 0, 0.82, 0));
  body.add(part(new THREE.DodecahedronGeometry(0.24, 0), moss, 0.28, 1.08, -0.05, 1.05));
  body.add(part(new THREE.DodecahedronGeometry(0.2, 0), moss, -0.3, 1.06, -0.02, 1.05));
  const head = joint(body, 0, 1.22, 0.05);
  head.add(part(new THREE.DodecahedronGeometry(0.17, 0), stone, 0, 0.06, 0));
  for (const s of [-1, 1]) head.add(part(ball(0.035, 0), toon('#ffcf5a', '#ffa020'), s * 0.07, 0.08, 0.14, 1));
  const mkArm = (side: number) => {
    const sh = joint(body, side * 0.46, 1.04, 0);
    sh.add(part(cyl(0.11, 0.1, 0.5, 6), dark, 0, -0.25, 0));
    sh.add(part(new THREE.DodecahedronGeometry(0.2, 0), stone, 0, -0.58, 0.04));
    return sh;
  };
  return { kind: 'ravager', root, body, head, armL: mkArm(1), armR: mkArm(-1), legL, legR };
}

function mage(): TroopRig {
  const r = humanoid('mage', { body: '#7a3aa8', trim: '#ff8a2b', legs: '#4a2266' });
  r.body.add(part(cone(0.3, 0.5, 8), toon('#6a2f98'), 0, 0.3, 0, 1.04));
  const hat = part(cone(0.2, 0.42, 8), toon('#5a2888'), 0, 0.42, -0.02);
  hat.rotation.x = -0.25;
  r.head!.add(hat);
  r.head!.add(part(cyl(0.25, 0.25, 0.03, 10), toon('#5a2888'), 0, 0.24, 0, 1.04));
  r.gripR.add(part(cyl(0.025, 0.03, 0.8, 5), toon('#6b4424'), 0, 0.3, 0.04));
  r.gripR.add(part(ball(0.09, 1), toon('#ffd25a', '#ff7a1a'), 0, 0.74, 0.04, 1.12));
  return r;
}

function dragon(): TroopRig {
  const root = new THREE.Group();
  root.add(blobShadow(0.9, 0.7));
  const body = new THREE.Group();
  body.position.y = DRAGON_Y;
  root.add(body);
  const red = toon('#d0442a');
  const belly = toon('#ffcf6a');
  const horn = toon('#f2e6c8');
  const torso = part(ball(0.42, 1), red, 0, 0, 0);
  torso.scale.set(1, 0.8, 1.35);
  body.add(torso);
  const bellyM = part(ball(0.3, 1), belly, 0, -0.12, 0.08, 1.04);
  bellyM.scale.set(1, 0.7, 1.3);
  body.add(bellyM);
  const neck = joint(body, 0, 0.15, 0.45);
  neck.add(part(cyl(0.13, 0.18, 0.4, 6), red, 0, 0.12, 0.08));
  const head = joint(neck, 0, 0.32, 0.18);
  head.add(part(box(0.28, 0.24, 0.38), red, 0, 0, 0.08));
  head.add(part(box(0.22, 0.08, 0.2), belly, 0, -0.1, 0.2, 1.04));
  for (const s of [-1, 1]) {
    const h = part(cone(0.05, 0.24, 5), horn, s * 0.1, 0.18, -0.06, 1.05);
    h.rotation.x = -0.7;
    head.add(h);
    head.add(part(ball(0.035, 0), toon('#fff2a0', '#ffb030'), s * 0.09, 0.06, 0.22, 1));
  }
  const tail = joint(body, 0, 0, -0.5);
  const t1 = part(cone(0.16, 0.7, 6), red, 0, 0, -0.3);
  t1.rotation.x = -Math.PI / 2;
  tail.add(t1);
  const mkWing = (side: number) => {
    const w = joint(body, side * 0.32, 0.18, 0);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(side * 1.1, 0.35);
    shape.lineTo(side * 0.95, -0.05);
    shape.lineTo(side * 0.7, -0.22);
    shape.lineTo(side * 0.4, -0.18);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: '#a8321e', side: THREE.DoubleSide }));
    w.add(m);
    const edge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#1a1208', side: THREE.BackSide }));
    edge.scale.setScalar(1.04);
    w.add(edge);
    return w;
  };
  for (const s of [-1, 1]) {
    const leg = part(box(0.12, 0.22, 0.14), red, s * 0.22, -0.32, 0.12);
    body.add(leg);
  }
  return { kind: 'drake', root, body, head, neck, tail, wingL: mkWing(1), wingR: mkWing(-1) };
}

function general(a: Appearance): TroopRig {
  const g = buildGeneral(a);
  g.root.scale.setScalar(0.62);
  const root = new THREE.Group();
  root.add(blobShadow(0.34));
  root.add(g.root);
  return { kind: 'general', root, body: g.root, head: g.head, armL: g.leftArm, armR: g.rightArm, general: g };
}

export function buildTroop(kind: TroopId, appearance?: Appearance): TroopRig {
  switch (kind) {
    case 'shield':
      return swordsman();
    case 'longbow':
      return archer();
    case 'sapper':
      return sapper();
    case 'ravager':
      return stoneGiant();
    case 'mage':
      return mage();
    case 'drake':
      return dragon();
    case 'general':
      if (!appearance) throw new Error('the General needs an appearance');
      return general(appearance);
  }
}

/** Pose a rig for animation `anim` at phase f ∈ [0, 1). Resets every animated part first. */
export function pose(r: TroopRig, anim: Anim, f: number) {
  const s = Math.sin(f * Math.PI * 2);
  for (const o of [r.armL, r.armR, r.legL, r.legR, r.head, r.neck, r.tail, r.wingL, r.wingR]) o?.rotation.set(0, 0, 0);
  r.root.rotation.set(0, r.root.rotation.y, 0);
  r.root.position.y = 0;
  const bodyY = r.kind === 'drake' ? DRAGON_Y : 0;
  r.body.position.y = bodyY;
  r.body.rotation.set(0, 0, 0);
  if (r.general) {
    r.general.rightArm.rotation.x = -0.25;
    r.general.leftArm.rotation.x = -0.15;
  }
  if (r.kind === 'drake') return poseDragon(r, anim, f, s);
  switch (anim) {
    case 'idle':
      r.body.position.y = bodyY + Math.max(0, s) * 0.015;
      if (r.armL) r.armL.rotation.x = s * 0.06;
      if (r.armR) r.armR.rotation.x = -s * 0.06;
      if (r.head) r.head.rotation.y = s * 0.08;
      break;
    case 'walk': {
      const stride = r.kind === 'ravager' ? 0.45 : 0.65;
      if (r.legL) r.legL.rotation.x = s * stride;
      if (r.legR) r.legR.rotation.x = -s * stride;
      if (r.armL) r.armL.rotation.x = -s * 0.55;
      if (r.armR) r.armR.rotation.x = s * 0.55;
      r.body.position.y = bodyY + Math.abs(Math.cos(f * Math.PI * 2)) * (r.kind === 'ravager' ? 0.06 : 0.04);
      r.body.rotation.z = s * (r.kind === 'ravager' ? 0.06 : 0.03);
      break;
    }
    case 'attack':
      poseAttack(r, f);
      break;
    case 'death': {
      const e = easeIn(f);
      r.root.rotation.x = -e * (Math.PI / 2) * 0.95;
      r.root.position.y = -e * 0.05;
      if (r.armL) r.armL.rotation.z = e * 1.1;
      if (r.armR) r.armR.rotation.z = -e * 1.1;
      break;
    }
  }
}

/** Wind-up (0–0.4), strike (0.4–0.7), recover (0.7–1). */
function poseAttack(r: TroopRig, f: number) {
  const up = f < 0.4 ? easeOut(f / 0.4) : f < 0.7 ? 1 - easeIn((f - 0.4) / 0.3) : 0;
  const hit = f < 0.4 ? 0 : f < 0.7 ? easeIn((f - 0.4) / 0.3) : 1 - easeOut((f - 0.7) / 0.3);
  switch (r.kind) {
    case 'ravager':
      // both fists up, then a double slam with a forward lean
      if (r.armL) r.armL.rotation.x = -up * 2.6 + hit * 0.5;
      if (r.armR) r.armR.rotation.x = -up * 2.6 + hit * 0.5;
      r.body.rotation.x = hit * 0.35 - up * 0.1;
      break;
    case 'longbow':
      // bow arm forward, string arm draws back, release
      if (r.armL) r.armL.rotation.x = -1.45;
      if (r.armR) {
        r.armR.rotation.x = -1.3;
        r.armR.rotation.y = -up * 0.6;
      }
      break;
    case 'mage':
      // staff raised, then thrust forward
      if (r.armR) r.armR.rotation.x = -up * 2.2 - hit * 1.1;
      if (r.armL) r.armL.rotation.x = -hit * 0.8;
      r.body.rotation.x = hit * 0.12;
      break;
    case 'sapper':
      if (r.armR) r.armR.rotation.x = -up * 2.4 - hit * 0.4;
      break;
    default:
      // sword / General: overhead slash
      if (r.armR) r.armR.rotation.x = -up * 2.5 + hit * 0.9;
      if (r.armL) r.armL.rotation.x = -0.5;
      r.body.rotation.y = -hit * 0.25;
  }
}

function poseDragon(r: TroopRig, anim: Anim, f: number, s: number) {
  const flap = anim === 'death' ? 0 : Math.sin(f * Math.PI * 2 * (anim === 'walk' ? 1 : 0.5));
  if (r.wingL) r.wingL.rotation.z = -0.25 - flap * 0.55;
  if (r.wingR) r.wingR.rotation.z = 0.25 + flap * 0.55;
  if (r.tail) r.tail.rotation.y = s * 0.3;
  r.body.position.y = DRAGON_Y + flap * 0.05;
  if (anim === 'attack') {
    const breathe = f < 0.3 ? -easeOut(f / 0.3) * 0.5 : easeIn(Math.min(1, (f - 0.3) / 0.3)) * 0.6;
    if (r.neck) r.neck.rotation.x = breathe;
    if (r.head) r.head.rotation.x = breathe * 0.4;
  } else if (anim === 'death') {
    const e = easeIn(f);
    r.body.position.y = DRAGON_Y * (1 - e) + 0.2;
    r.body.rotation.z = e * 0.9;
    if (r.wingL) r.wingL.rotation.z = -0.1 + e * 0.6;
    if (r.wingR) r.wingR.rotation.z = 0.1 + e * 0.4;
    if (r.neck) r.neck.rotation.x = e * 0.8;
  }
}

/** Frame size (px) and bake scale (px per tile) for each troop's sprite cells. */
export const TROOP_FRAME: Record<TroopId, { size: number; scale: number }> = {
  shield: { size: 96, scale: 64 },
  longbow: { size: 96, scale: 64 },
  sapper: { size: 96, scale: 64 },
  mage: { size: 96, scale: 64 },
  general: { size: 104, scale: 64 },
  ravager: { size: 144, scale: 64 },
  drake: { size: 176, scale: 56 },
};
