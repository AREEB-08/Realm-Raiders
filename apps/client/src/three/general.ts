import * as THREE from 'three';
import type { Appearance } from '@realm/shared';

/**
 * The General (§12): an original low-poly figure assembled from primitives, so every part swap
 * and colour change is instant (< 100 ms) and needs no downloaded model. The parts catalog
 * mirrors §12.1 (body, head, hair/helm, cloak, weapon, shield, colours); CC0 GLB parts can
 * replace any builder later without changing the Appearance schema.
 */
const mats = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, opts: { metal?: number; rough?: number; emissive?: string; flat?: boolean } = {}) {
  const key = `${color}|${opts.metal ?? 0}|${opts.rough ?? 0.8}|${opts.emissive ?? ''}`;
  let m = mats.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metal ?? 0,
      roughness: opts.rough ?? 0.8,
      flatShading: opts.flat ?? true,
      ...(opts.emissive ? { emissive: new THREE.Color(opts.emissive), emissiveIntensity: 1.2 } : {}),
    });
    mats.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

const BODY = {
  warden: { width: 1.3, height: 1.0, plate: true, robe: false },
  knight: { width: 1.12, height: 1.04, plate: true, robe: false },
  ranger_scout: { width: 0.95, height: 0.98, plate: false, robe: false },
  runecaller: { width: 0.95, height: 1.02, plate: false, robe: true },
  longstrider: { width: 0.98, height: 1.12, plate: false, robe: false },
} as const;

export interface GeneralRig {
  root: THREE.Group;
  torso: THREE.Object3D;
  cloak: THREE.Object3D | null;
  rightArm: THREE.Object3D;
  leftArm: THREE.Object3D;
  head: THREE.Object3D;
  banner: THREE.Object3D | null;
}

export function buildGeneral(a: Appearance): GeneralRig {
  const b = BODY[a.body];
  const c = a.colors;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.scale.set(b.width, b.height, b.width);
  root.add(body);
  const skin = mat(c.skin, { rough: 0.9 });
  const primary = mat(c.primary);
  const secondary = mat(c.secondary);
  const metal = mat(c.metal, { metal: 0.7, rough: 0.35 });
  const leather = mat('#5a3e26');
  const hairMat = mat(c.hair);

  // legs + boots
  for (const side of [-1, 1]) {
    body.add(mesh(new THREE.BoxGeometry(0.22, 0.62, 0.24), b.plate ? metal : leather, side * 0.15, 0.42, 0));
    body.add(mesh(new THREE.BoxGeometry(0.26, 0.14, 0.34), mat('#2b2116'), side * 0.15, 0.07, 0.04));
  }
  // robe skirt
  if (b.robe) body.add(mesh(new THREE.ConeGeometry(0.42, 0.85, 7, 1, true), primary, 0, 0.5, 0));
  // torso
  const torso = new THREE.Group();
  torso.position.y = 1.05;
  body.add(torso);
  torso.add(mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.62, 7), primary, 0, 0, 0));
  torso.add(mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.08, 7), leather, 0, -0.27, 0));
  torso.add(mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), mat('#e8c35a', { metal: 0.8, rough: 0.3 }), 0, -0.27, 0.28));
  if (b.plate) {
    torso.add(mesh(new THREE.CylinderGeometry(0.33, 0.29, 0.42, 7), metal, 0, 0.08, 0));
    const tabard = mesh(new THREE.BoxGeometry(0.2, 0.46, 0.03), secondary, 0, -0.12, 0.32);
    torso.add(tabard);
  } else {
    torso.add(mesh(new THREE.BoxGeometry(0.4, 0.06, 0.05), secondary, 0, 0.18, 0.27));
  }
  // arms
  const mkArm = (side: number) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 0.22, 0);
    arm.add(mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.55, 6), b.plate ? metal : primary, 0, -0.26, 0));
    arm.add(mesh(new THREE.SphereGeometry(0.085, 6, 5), skin, 0, -0.56, 0));
    if (b.plate) arm.add(mesh(new THREE.SphereGeometry(0.16, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0.02, 0));
    torso.add(arm);
    return arm;
  };
  const rightArm = mkArm(-1);
  const leftArm = mkArm(1);
  rightArm.rotation.x = -0.25;
  leftArm.rotation.x = -0.15;
  // head
  const head = new THREE.Group();
  head.position.y = 0.55;
  torso.add(head);
  head.add(mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.12, 6), skin, 0, -0.08, 0));
  head.add(mesh(new THREE.IcosahedronGeometry(0.21, 1), skin, 0, 0.12, 0));
  for (const side of [-1, 1]) head.add(mesh(new THREE.SphereGeometry(0.025, 5, 4), mat('#1a1410'), side * 0.075, 0.15, 0.185));
  if (a.head === 'scarred') head.add(mesh(new THREE.BoxGeometry(0.02, 0.14, 0.02), mat('#9a3a2a'), 0.1, 0.13, 0.19));
  if (a.head === 'bearded' || a.head === 'braided') {
    // A pointed beard hanging below the mouth (apex down).
    const beard = mesh(new THREE.ConeGeometry(0.14, 0.26, 6), hairMat, 0, -0.04, 0.13);
    beard.rotation.x = Math.PI;
    head.add(beard);
    if (a.head === 'braided') head.add(mesh(new THREE.CylinderGeometry(0.03, 0.02, 0.22, 5), hairMat, 0, -0.18, 0.15));
  }
  // hair / helm
  switch (a.hair) {
    case 'short':
      head.add(mesh(new THREE.SphereGeometry(0.225, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2.1), hairMat, 0, 0.14, -0.01));
      break;
    case 'long_braid':
      head.add(mesh(new THREE.SphereGeometry(0.225, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2.1), hairMat, 0, 0.14, -0.01));
      head.add(mesh(new THREE.CylinderGeometry(0.05, 0.03, 0.55, 5), hairMat, 0, -0.15, -0.2));
      break;
    case 'hood':
      head.add(mesh(new THREE.ConeGeometry(0.3, 0.55, 7, 1, true), primary, 0, 0.22, -0.03));
      break;
    case 'horned_helm':
      head.add(mesh(new THREE.SphereGeometry(0.235, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0.12, 0));
      for (const side of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.05, 0.3, 5), mat('#efe4c8'), side * 0.25, 0.25, 0);
        horn.rotation.z = -side * 0.9;
        head.add(horn);
      }
      break;
    case 'circlet':
      head.add(mesh(new THREE.TorusGeometry(0.21, 0.02, 4, 12), mat('#e8c35a', { metal: 0.9, rough: 0.25 }), 0, 0.2, 0));
      head.children[head.children.length - 1]!.rotation.x = Math.PI / 2;
      head.add(mesh(new THREE.SphereGeometry(0.225, 7, 5, 0, Math.PI * 2, 0, Math.PI / 2.4), hairMat, 0, 0.15, -0.02));
      break;
  }
  // cloak / banner
  let cloak: THREE.Object3D | null = null;
  let banner: THREE.Object3D | null = null;
  if (a.cloak === 'short_cape' || a.cloak === 'long_cloak') {
    const len = a.cloak === 'long_cloak' ? 1.2 : 0.6;
    const geo = new THREE.CylinderGeometry(0.34, 0.5, len, 8, 1, true, Math.PI * 0.6, Math.PI * 0.8);
    cloak = mesh(geo, mat(c.secondary === c.primary ? c.metal : c.secondary, { flat: true }), 0, 0.28 - len / 2, -0.04);
    (cloak as THREE.Mesh).material = new THREE.MeshStandardMaterial({ color: c.primary, flatShading: true, side: THREE.DoubleSide, roughness: 0.9 });
    torso.add(cloak);
  } else if (a.cloak === 'banner_pole') {
    banner = new THREE.Group();
    banner.position.set(0.15, 0.1, -0.3);
    banner.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.6, 5), mat('#5a3e26'), 0, 0.5, 0));
    const cloth = mesh(new THREE.PlaneGeometry(0.45, 0.6, 3, 3), new THREE.MeshStandardMaterial({ color: c.primary, side: THREE.DoubleSide, flatShading: true }), 0.23, 1.0, 0);
    banner.add(cloth);
    torso.add(banner);
  }
  // weapon (right hand)
  const hand = new THREE.Group();
  hand.position.set(0, -0.58, 0.05);
  rightArm.add(hand);
  switch (a.weapon) {
    case 'sword':
      hand.add(mesh(new THREE.BoxGeometry(0.06, 0.75, 0.02), mat('#d9d9d9', { metal: 0.9, rough: 0.25 }), 0, 0.42, 0));
      hand.add(mesh(new THREE.BoxGeometry(0.24, 0.04, 0.05), metal, 0, 0.05, 0));
      hand.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.14, 5), leather, 0, -0.04, 0));
      break;
    case 'axe':
      hand.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.85, 5), leather, 0, 0.3, 0));
      hand.add(mesh(new THREE.BoxGeometry(0.28, 0.2, 0.03), mat('#cfcfcf', { metal: 0.85, rough: 0.3 }), 0.12, 0.62, 0));
      break;
    case 'spear':
      hand.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.5, 5), leather, 0, 0.45, 0));
      hand.add(mesh(new THREE.ConeGeometry(0.06, 0.24, 5), mat('#d9d9d9', { metal: 0.9, rough: 0.25 }), 0, 1.3, 0));
      break;
    case 'staff':
      hand.add(mesh(new THREE.CylinderGeometry(0.03, 0.035, 1.4, 5), mat('#4a3420'), 0, 0.4, 0));
      hand.add(mesh(new THREE.IcosahedronGeometry(0.09, 0), mat('#9fe6ff', { emissive: '#3aa6c9' }), 0, 1.15, 0));
      break;
    case 'bow': {
      const bow = mesh(new THREE.TorusGeometry(0.42, 0.02, 4, 12, Math.PI), mat('#6b4a2a'), 0, 0.25, 0);
      bow.rotation.z = Math.PI / 2;
      hand.add(bow);
      break;
    }
    case 'hammer':
      hand.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 5), leather, 0, 0.28, 0));
      hand.add(mesh(new THREE.BoxGeometry(0.26, 0.16, 0.16), metal, 0, 0.66, 0));
      break;
  }
  // shield (left arm)
  if (a.shield) {
    const sh = new THREE.Group();
    sh.position.set(0.08, -0.4, 0.12);
    sh.rotation.y = -0.3;
    leftArm.add(sh);
    if (a.shield === 'round') {
      const disc = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 10), secondary, 0, 0, 0);
      disc.rotation.x = Math.PI / 2;
      sh.add(disc);
      const boss = mesh(new THREE.SphereGeometry(0.07, 6, 4), metal, 0, 0, 0.04);
      sh.add(boss);
    } else {
      const shape = new THREE.Shape();
      const tall = a.shield === 'kite' ? 0.62 : 0.42;
      shape.moveTo(-0.22, 0.2);
      shape.lineTo(0.22, 0.2);
      shape.lineTo(0.22, 0);
      shape.quadraticCurveTo(0.2, -tall + 0.15, 0, -tall + 0.05);
      shape.quadraticCurveTo(-0.2, -tall + 0.15, -0.22, 0);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false });
      sh.add(mesh(geo, secondary, 0, 0, 0));
      sh.add(mesh(new THREE.BoxGeometry(0.06, tall * 0.8, 0.02), primary, 0, -tall / 2 + 0.15, 0.045));
    }
  }
  return { root, torso, cloak, rightArm, leftArm, head, banner };
}

/** Idle animation: breathing, cloak sway, a resting weapon bob. */
export function animateGeneral(rig: GeneralRig, t: number) {
  rig.torso.scale.y = 1 + Math.sin(t * 2) * 0.012;
  rig.rightArm.rotation.x = -0.25 + Math.sin(t * 1.3) * 0.04;
  rig.leftArm.rotation.x = -0.15 + Math.sin(t * 1.3 + 1) * 0.03;
  rig.head.rotation.y = Math.sin(t * 0.7) * 0.12;
  if (rig.cloak) rig.cloak.rotation.x = Math.sin(t * 1.7) * 0.05 + 0.05;
  if (rig.banner) rig.banner.rotation.z = Math.sin(t * 1.9) * 0.04;
}

export function disposeTree(o: THREE.Object3D) {
  o.traverse((n) => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
  });
}
