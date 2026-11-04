import * as THREE from 'three';
import { BUILDINGS, type BuildingId } from '@realm/game-data';
import { blobShadow, box, cone, cyl, part, toon } from './kit';

/**
 * Code-built low-poly buildings (spec F6): one model per type, and every upgrade level visibly
 * different — taller, wood → stone → dark stone, gold trim from level 4, more banners, extra
 * chimneys / tents / crystals. The model is centred on its footprint (s × s tiles, 1 unit = 1
 * tile) and faces the camera's corner. `banner` is the owner's faction colour.
 */
const C = {
  wood: '#b07a3e',
  woodDark: '#7a5230',
  plank: '#c9965a',
  stone: '#b5bcc2',
  stoneDark: '#858d94',
  stoneDeep: '#5f676e',
  roof: '#c9452e',
  gold: '#f2c14e',
  iron: '#4a5058',
  thatch: '#d8b25a',
  ember: '#ff8a2b',
  rune: '#b88cff',
  leaf: '#4f9a3a',
  dirt: '#9b7444',
};

/** Material of the main walls by level: 1 wood · 2 light stone · 3 stone · 4–5 dark stone. */
const wallMat = (lv: number) => toon(lv <= 1 ? C.wood : lv === 2 ? C.stone : lv === 3 ? C.stoneDark : C.stoneDeep);
const trimMat = (lv: number) => toon(lv >= 4 ? C.gold : C.woodDark);

/** A 4-sided pyramid roof (rotated so its edges follow the footprint). */
function pyramid(w: number, h: number, color: string) {
  const r = part(cone(w * Math.SQRT1_2, h, 4), toon(color));
  r.rotation.y = Math.PI / 4;
  return r;
}

/** A gable (prism) roof along X. */
function gable(w: number, d: number, h: number, color: string) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, 0);
  shape.lineTo(d / 2, 0);
  shape.lineTo(0, h);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  geo.translate(0, 0, -w / 2);
  geo.rotateY(Math.PI / 2);
  return part(geo, toon(color));
}

function flag(color: string, h = 0.7) {
  const g = new THREE.Group();
  g.add(part(cyl(0.025, 0.025, h, 5), toon(C.woodDark)));
  g.children[0]!.position.y = h / 2;
  const cloth = part(box(0.28, 0.18, 0.02), toon(color), 0.15, h - 0.12, 0);
  g.add(cloth);
  return g;
}

function crenels(w: number, d: number, y: number, mat: THREE.Material, size = 0.14) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.round(w / 0.32));
  for (let i = 0; i < n; i++) {
    const t = -w / 2 + size / 2 + (i * (w - size)) / (n - 1);
    for (const z of [-d / 2 + size / 2, d / 2 - size / 2]) g.add(part(box(size, size, size), mat, t, y + size / 2, z, 1));
    for (const x of [-d / 2 + size / 2, d / 2 - size / 2]) g.add(part(box(size, size, size), mat, x, y + size / 2, t, 1));
  }
  return g;
}

function plinth(s: number, color: string) {
  return part(box(s - 0.14, 0.06, s - 0.14), toon(color), 0, 0.03, 0, 1);
}

function citadel(lv: number, banner: string) {
  const g = new THREE.Group();
  const tall = 1 + 0.16 * (lv - 1);
  g.add(part(box(3.1, 0.55, 3.1), wallMat(Math.max(2, lv)), 0, 0.35, 0));
  if (lv >= 2) g.add(crenels(3.1, 3.1, 0.62, wallMat(Math.max(2, lv))));
  g.add(part(box(1.9, 1.3 * tall, 1.9), toon(lv >= 4 ? C.stoneDark : C.stone), 0, 0.62 + (0.65 * tall), 0));
  const roof = pyramid(2.2, 1.0 + 0.1 * lv, banner);
  roof.position.y = 0.62 + 1.3 * tall + 0.5;
  g.add(roof);
  for (const [x, z] of [[-1.45, -1.45], [1.45, -1.45], [1.45, 1.45], [-1.45, 1.45]] as const) {
    const th = 1.5 * tall;
    g.add(part(cyl(0.34, 0.38, th, 8), wallMat(Math.max(2, lv)), x, th / 2 + 0.08, z));
    const cap = part(cone(0.45, 0.6, 8), toon(banner), x, th + 0.38, z);
    g.add(cap);
    if (lv >= 4) g.add(part(cyl(0.4, 0.4, 0.06, 8), toon(C.gold), x, th + 0.09, z, 1));
  }
  g.add(part(box(0.55, 0.6, 0.12), toon(C.iron), 0, 0.42, 1.56));
  g.add(part(box(0.66, 0.08, 0.14), trimMat(lv), 0, 0.76, 1.56, 1));
  const f = flag(banner, 0.8 + 0.1 * lv);
  f.position.set(0, roof.position.y + 0.4, 0);
  g.add(f);
  if (lv >= 5) {
    const spire = part(cone(0.18, 0.9, 6), toon(C.gold), 0, roof.position.y + 1.0, 0);
    g.add(spire);
  }
  return g;
}

function goldworks(lv: number) {
  const g = new THREE.Group();
  g.add(part(box(1.7, 0.9, 1.5), wallMat(Math.max(2, lv)), -0.2, 0.53, 0));
  g.add(part(box(1.85, 0.12, 1.65), toon(lv >= 3 ? '#c87a3a' : C.woodDark), -0.2, 1.04, 0));
  g.add(part(box(0.5, 0.45, 0.06), toon(C.ember, C.ember), -0.2, 0.36, 0.78));
  const chimneys = Math.min(3, 1 + Math.floor(lv / 2));
  for (let i = 0; i < chimneys; i++) {
    const x = -0.75 + i * 0.5;
    g.add(part(cyl(0.14, 0.17, 0.9 + 0.1 * lv, 6), toon(C.stoneDark), x, 1.4, -0.45));
    g.add(part(cyl(0.16, 0.16, 0.08, 6), toon('#3a3a3a'), x, 1.9 + 0.05 * lv, -0.45, 1));
  }
  for (let i = 0; i < 3 + lv; i++) g.add(part(new THREE.IcosahedronGeometry(0.13, 0), toon(C.gold), 0.95 + (i % 3) * 0.18 - 0.2, 0.16 + Math.floor(i / 3) * 0.14, 0.75 - (i % 2) * 0.2, 1.05));
  return g;
}

function treasury(lv: number) {
  const g = new THREE.Group();
  g.add(part(box(2.0, 0.95, 2.0), wallMat(Math.max(2, lv)), 0, 0.55, 0));
  const dome = part(new THREE.SphereGeometry(0.85 + 0.05 * lv, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), toon(lv >= 3 ? C.gold : '#c9a24a'), 0, 1.02, 0);
  g.add(dome);
  g.add(part(cyl(1.05, 1.05, 0.1, 10), trimMat(lv), 0, 1.04, 0, 1));
  g.add(part(box(0.5, 0.6, 0.08), toon(C.iron), 0, 0.38, 1.02));
  for (let i = 0; i < 2 + lv; i++) g.add(part(cyl(0.12, 0.12, 0.08, 8), toon(C.gold), -0.9 + (i % 4) * 0.2, 0.12 + Math.floor(i / 4) * 0.09, 1.25, 1));
  return g;
}

function logs(n: number, y: number, z: number, len = 1.2) {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const l = part(cyl(0.11, 0.11, len, 7), toon(i % 2 ? C.wood : C.plank), 0, y + 0.11 + Math.floor(i / 3) * 0.2, z + (i % 3) * 0.23 - 0.23);
    l.rotation.z = Math.PI / 2;
    g.add(l);
  }
  return g;
}

function lumbercamp(lv: number, banner: string) {
  const g = new THREE.Group();
  const h = 0.7 + 0.1 * lv;
  g.add(part(box(1.4, h, 1.2), toon(lv >= 3 ? C.stone : C.wood), -0.45, h / 2 + 0.08, -0.35));
  const r = gable(1.6, 1.4, 0.55, lv >= 2 ? banner : C.thatch);
  r.position.set(-0.45, h + 0.08, -0.35);
  g.add(r);
  g.add(logs(3 + Math.min(6, lv * 2), 0.08, 0.7));
  g.add(part(cyl(0.28, 0.3, 0.3, 8), toon(C.plank), 0.85, 0.23, -0.5));
  g.add(part(box(0.06, 0.4, 0.06), toon(C.woodDark), 0.85, 0.55, -0.5, 1));
  return g;
}

function timberyard(lv: number, banner: string) {
  const g = new THREE.Group();
  const stacks = Math.min(3, 1 + Math.floor((lv + 1) / 2));
  for (let k = 0; k < stacks; k++) {
    const st = logs(6, 0.08, 0);
    st.position.x = -0.8 + k * 0.8;
    st.rotation.y = Math.PI / 2;
    g.add(st);
  }
  for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) g.add(part(box(0.1, 1.1 + 0.08 * lv, 0.1), toon(C.woodDark), x, 0.6 + 0.04 * lv, z));
  const roof = part(box(2.6, 0.1, 2.6), toon(lv >= 3 ? banner : C.thatch), 0, 1.18 + 0.08 * lv, 0);
  g.add(roof);
  return g;
}

function emberwell(lv: number) {
  const g = new THREE.Group();
  g.add(part(cyl(0.75, 0.8, 0.45, 10), toon(C.stoneDark), 0, 0.3, 0));
  g.add(part(cyl(0.55, 0.55, 0.05, 10), toon(C.ember, '#ff5a10'), 0, 0.53, 0, 1));
  for (let i = 0; i < 2 + lv; i++) {
    const a = (i / (2 + lv)) * Math.PI * 2;
    const c = part(cone(0.1, 0.4 + 0.1 * (i % 2) + 0.06 * lv, 5), toon('#ffb05a', '#ff7a20'), Math.cos(a) * 0.62, 0.7, Math.sin(a) * 0.62, 1.05);
    c.rotation.z = Math.cos(a) * 0.3;
    c.rotation.x = -Math.sin(a) * 0.3;
    g.add(c);
  }
  return g;
}

function musterhall(lv: number, banner: string) {
  const g = new THREE.Group();
  const h = 0.8 + 0.12 * lv;
  g.add(part(box(2.2, h, 1.4), wallMat(lv), 0, h / 2 + 0.08, -0.3));
  const r = gable(2.4, 1.6, 0.7, banner);
  r.position.set(0, h + 0.08, -0.3);
  g.add(r);
  g.add(part(box(0.45, 0.55, 0.08), toon(C.woodDark), 0, 0.36, 0.42));
  const dummy = new THREE.Group();
  dummy.position.set(0.9, 0, 0.9);
  dummy.add(part(box(0.08, 0.7, 0.08), toon(C.woodDark), 0, 0.42, 0));
  dummy.add(part(box(0.45, 0.08, 0.08), toon(C.woodDark), 0, 0.6, 0));
  dummy.add(part(new THREE.IcosahedronGeometry(0.11, 0), toon(C.thatch), 0, 0.82, 0));
  g.add(dummy);
  const f = flag(banner, 1.0);
  f.position.set(-0.95, 0, 0.75);
  g.add(f);
  if (lv >= 4) g.add(part(box(2.25, 0.08, 1.45), toon(C.gold), 0, h + 0.1, -0.3, 1));
  return g;
}

function warcamp(lv: number, banner: string) {
  const g = new THREE.Group();
  const spots = [[-1.1, -1.0], [0.9, -1.1], [-1.2, 0.9], [1.1, 0.8], [0, -1.4]] as const;
  const n = Math.min(5, 2 + lv);
  for (let i = 0; i < n; i++) {
    const [x, z] = spots[i]!;
    const t = part(cone(0.6, 0.9, 4), toon(i % 2 ? banner : '#e8dcc0'), x, 0.53, z);
    t.rotation.y = Math.PI / 4 + i * 0.3;
    g.add(t);
  }
  g.add(part(cyl(0.3, 0.34, 0.12, 8), toon(C.stoneDark), 0, 0.14, 0.1));
  g.add(part(cone(0.2, 0.45, 6), toon('#ffd25a', '#ff7a1a'), 0, 0.42, 0.1, 1.05));
  const f = flag(banner, 1.2 + 0.1 * lv);
  f.position.set(0.3, 0, 0.6);
  g.add(f);
  return g;
}

function bowtower(lv: number, banner: string) {
  const g = new THREE.Group();
  const h = 1.6 + 0.25 * lv;
  if (lv <= 1) {
    for (const x of [-0.45, 0.45]) for (const z of [-0.45, 0.45]) g.add(part(box(0.14, h, 0.14), toon(C.wood), x, h / 2, z));
  } else g.add(part(cyl(0.6, 0.75, h, 8), wallMat(lv), 0, h / 2, 0));
  g.add(part(box(1.4, 0.16, 1.4), toon(C.plank), 0, h + 0.08, 0));
  g.add(crenels(1.4, 1.4, h + 0.16, toon(C.woodDark), 0.12));
  const roof = pyramid(1.5, 0.75, banner);
  roof.position.y = h + 0.78;
  g.add(roof);
  for (const x of [-0.6, 0.6]) for (const z of [-0.6, 0.6]) g.add(part(box(0.07, 0.5, 0.07), toon(C.woodDark), x, h + 0.42, z, 1));
  if (lv >= 4) g.add(part(cyl(0.66, 0.66, 0.08, 8), toon(C.gold), 0, h * 0.6, 0, 1));
  return g;
}

function stonethrower(lv: number) {
  const g = new THREE.Group();
  g.add(part(box(1.8, 0.35, 1.8), lv >= 2 ? wallMat(lv) : toon(C.wood), 0, 0.25, 0));
  for (const x of [-0.5, 0.5]) {
    const leg = part(box(0.14, 1.0, 0.14), toon(C.woodDark), x, 0.85, 0);
    g.add(leg);
  }
  g.add(part(box(1.15, 0.12, 0.12), toon(C.woodDark), 0, 1.3, 0));
  const arm = part(box(0.14, 0.14, 1.9), toon(C.wood), 0, 1.35, 0.1);
  arm.rotation.x = -0.55;
  g.add(arm);
  g.add(part(box(0.45, 0.45, 0.45), toon(C.stoneDeep), 0, 0.98, 0.85));
  // the loaded cup at the tip of the throwing arm (tip: z = 0.1 − 0.95·cos 0.55, y = 1.35 + 0.95·sin 0.55)
  g.add(part(box(0.34, 0.12, 0.34), toon(C.woodDark), 0, 1.84, -0.72));
  g.add(part(new THREE.DodecahedronGeometry(0.17, 0), toon(C.stoneDark), 0, 2.0, -0.72));
  for (let i = 0; i < 2 + lv; i++) g.add(part(new THREE.DodecahedronGeometry(0.13, 0), toon(C.stoneDark), -0.7 + (i % 3) * 0.2, 0.52 + Math.floor(i / 3) * 0.18, -0.65, 1.05));
  return g;
}

function obelisk(lv: number) {
  const g = new THREE.Group();
  const h = 1.8 + 0.35 * lv;
  g.add(part(cyl(0.22, 0.5, h, 4), toon('#4a4058'), 0, h / 2 + 0.08, 0));
  g.children[g.children.length - 1]!.rotation.y = Math.PI / 4;
  for (let i = 0; i < 2 + lv; i++) g.add(part(box(0.32 - i * 0.03, 0.05, 0.02), toon(C.rune, '#9a5aff'), 0, 0.5 + i * 0.35, 0.28 - i * 0.025, 1));
  g.add(part(new THREE.OctahedronGeometry(0.22, 0), toon('#e6d6ff', '#a878ff'), 0, h + 0.4, 0, 1.12));
  return g;
}

function ballista(lv: number) {
  const g = new THREE.Group();
  g.add(part(cyl(1.0, 1.15, 0.5, 8), wallMat(Math.max(2, lv)), 0, 0.33, 0));
  const mount = new THREE.Group();
  mount.position.y = 0.7;
  mount.rotation.y = -0.6;
  g.add(mount);
  mount.add(part(box(0.3, 0.3, 0.3), toon(C.woodDark), 0, 0.1, 0));
  mount.add(part(box(0.2, 0.16, 1.6 + 0.1 * lv), toon(C.wood), 0, 0.32, 0.1));
  for (const s of [-1, 1]) {
    const limb = part(box(0.9 + 0.1 * lv, 0.1, 0.1), toon(lv >= 4 ? C.gold : C.woodDark), s * 0.45, 0.34, 0.75);
    limb.rotation.y = s * 0.35;
    mount.add(limb);
  }
  mount.add(part(cyl(0.04, 0.04, 1.6, 5), toon(C.iron), 0, 0.46, 0.2, 1));
  mount.children[mount.children.length - 1]!.rotation.x = Math.PI / 2;
  mount.add(part(cone(0.08, 0.22, 5), toon('#d9d9d9'), 0, 0.46, 1.05, 1));
  mount.children[mount.children.length - 1]!.rotation.x = Math.PI / 2;
  return g;
}

function wall(lv: number) {
  const g = new THREE.Group();
  if (lv <= 1) {
    // wooden palisade: a ring of pointed stakes tied by two rails, so neighbours read as one fence
    for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3], [0, 0]] as const) {
      g.add(part(cyl(0.13, 0.14, 0.62, 6), toon(C.wood), x, 0.31, z));
      g.add(part(cone(0.13, 0.2, 6), toon(C.plank), x, 0.72, z, 1));
    }
    for (const y of [0.22, 0.48]) {
      g.add(part(box(0.9, 0.06, 0.08), toon(C.woodDark), 0, y, 0, 1));
      g.add(part(box(0.08, 0.06, 0.9), toon(C.woodDark), 0, y, 0, 1));
    }
    return g;
  }
  const h = 0.55 + 0.06 * lv;
  g.add(part(box(0.98, h, 0.98), wallMat(lv), 0, h / 2, 0));
  if (lv >= 3) for (const [x, z] of [[-0.3, -0.3], [0.3, 0.3], [-0.3, 0.3], [0.3, -0.3]] as const) g.add(part(box(0.26, 0.16, 0.26), wallMat(lv), x, h + 0.08, z, 1));
  if (lv >= 4) g.add(part(box(1.0, 0.07, 1.0), toon(C.gold), 0, h * 0.62, 0, 1));
  if (lv >= 5) for (const [x, z] of [[0, -0.45], [0, 0.45], [-0.45, 0], [0.45, 0]] as const) g.add(part(cone(0.06, 0.22, 4), toon(C.iron), x, h + 0.2, z, 1));
  return g;
}

function caltrops(lv: number) {
  const g = new THREE.Group();
  g.add(part(cyl(0.42, 0.45, 0.06, 10), toon('#4a3a28'), 0, 0.04, 0));
  for (let i = 0; i < 4 + lv * 2; i++) {
    const a = (i / (4 + lv * 2)) * Math.PI * 2;
    const r = 0.12 + (i % 2) * 0.16;
    g.add(part(cone(0.05, 0.16, 4), toon(C.iron), Math.cos(a) * r, 0.14, Math.sin(a) * r, 1));
  }
  return g;
}

export function buildBuilding(type: BuildingId, level: number, banner: string): THREE.Group {
  const lv = Math.max(1, Math.min(BUILDINGS[type].maxLevel, level));
  const s = BUILDINGS[type].size;
  const root = new THREE.Group();
  if (type !== 'wall') root.add(blobShadow(s * 0.55, 1));
  let m: THREE.Group;
  switch (type) {
    case 'citadel':
      m = citadel(lv, banner);
      break;
    case 'goldworks':
      m = goldworks(lv);
      break;
    case 'treasury':
      m = treasury(lv);
      break;
    case 'lumbercamp':
      m = lumbercamp(lv, banner);
      break;
    case 'timberyard':
      m = timberyard(lv, banner);
      break;
    case 'emberwell':
      m = emberwell(lv);
      break;
    case 'musterhall':
      m = musterhall(lv, banner);
      break;
    case 'warcamp':
      m = warcamp(lv, banner);
      break;
    case 'bowtower':
      m = bowtower(lv, banner);
      break;
    case 'stonethrower':
      m = stonethrower(lv);
      break;
    case 'obelisk':
      m = obelisk(lv);
      break;
    case 'ballista':
      m = ballista(lv);
      break;
    case 'wall':
      m = wall(lv);
      break;
    case 'caltrops':
      m = caltrops(lv);
      break;
  }
  if (type !== 'wall' && type !== 'caltrops') root.add(plinth(s, PAD[type] ?? '#6f9442'));
  m.scale.setScalar(FILL[type] ?? 1);
  root.add(m);
  return root;
}

/** Grow each model to fill its footprint (chunky and readable at island zoom). */
const FILL: Partial<Record<BuildingId, number>> = {
  goldworks: 1.32,
  treasury: 1.28,
  lumbercamp: 1.25,
  timberyard: 1.08,
  emberwell: 1.12,
  musterhall: 1.18,
  warcamp: 1.0,
  bowtower: 1.15,
  stonethrower: 1.22,
  obelisk: 1.1,
  ballista: 1.15,
};
/** Footprint pad colour: stone for the Citadel and rune works, darker grass for the rest. */
const PAD: Partial<Record<BuildingId, string>> = { citadel: '#8f979e', obelisk: '#5f676e', ballista: '#858d94', emberwell: '#6f6a66' };

/** Tallest point of each type above its footprint (tiles), for the bake canvas. */
export const BUILDING_HEIGHT: Record<BuildingId, number> = {
  citadel: 4.4,
  goldworks: 2.4,
  treasury: 2.2,
  lumbercamp: 1.9,
  timberyard: 1.7,
  emberwell: 1.4,
  musterhall: 2.3,
  warcamp: 2.2,
  bowtower: 3.9,
  stonethrower: 2.4,
  obelisk: 4.2,
  ballista: 1.6,
  wall: 1.0,
  caltrops: 0.4,
};
