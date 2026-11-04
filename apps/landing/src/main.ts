import '@fontsource/cinzel/700.css';
import '@fontsource/almendra/400.css';
import './style.css';
import * as THREE from 'three';

/**
 * Cinematic hero: a low-poly storm island at dusk with drifting embers and a slow orbiting
 * camera. Original procedural scene; pauses when off-screen; respects reduced motion.
 */
function hero(canvas: HTMLCanvasElement) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#2a2346', 18, 46);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight('#ffb98a', '#1a2a3a', 1.4));
  const sun = new THREE.DirectionalLight('#ff9a5a', 2.4);
  sun.position.set(-8, 6, -6);
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#7fd4d0', 1.2);
  rim.position.set(6, 5, 8);
  scene.add(rim);
  const flat = (color: string) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85 });
  // forest floor and a dense ring of pines (two InstancedMeshes: one draw call each)
  const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshStandardMaterial({ color: '#3d7a34', roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.45;
  scene.add(floor);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.7, 2.2, 7), flat('#2f6b3a'), 220);
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.16, 0.6, 5), flat('#6b4424'), 220);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const shades = ['#2f6b3a', '#3a7d3c', '#28583a'].map((c) => new THREE.Color(c));
  for (let i = 0; i < 220; i++) {
    const a = (i / 220) * Math.PI * 2 * 7.3;
    const r = 9 + ((i * 37) % 100) / 100 * 13;
    const s = 0.8 + ((i * 53) % 100) / 100 * 0.7;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    m.compose(new THREE.Vector3(x, 0.65 * s, z), q, new THREE.Vector3(s, s, s));
    crowns.setMatrixAt(i, m);
    crowns.setColorAt(i, shades[i % 3]!);
    m.compose(new THREE.Vector3(x, -0.15, z), q, new THREE.Vector3(s, s, s));
    trunks.setMatrixAt(i, m);
  }
  scene.add(crowns, trunks);
  // island
  const island = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(6, 7.2, 1.4, 9), flat('#58833f'));
  top.position.y = 0.3;
  island.add(top);
  const shore = new THREE.Mesh(new THREE.CylinderGeometry(7.4, 7.6, 0.4, 9), flat('#a8865a'));
  shore.position.y = -0.3;
  island.add(shore);
  const keep = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), flat('#8d8a83'));
  keep.position.y = 1.8;
  island.add(keep);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.4, 1.2, 4), flat('#4a5866'));
  roof.position.y = 3.2;
  roof.rotation.y = Math.PI / 4;
  island.add(roof);
  for (const [x, z] of [
    [-1.1, -1.1],
    [1.1, -1.1],
    [1.1, 1.1],
    [-1.1, 1.1],
  ]) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 2.4, 6), flat('#8d8a83'));
    tower.position.set(x!, 2.1, z!);
    island.add(tower);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.7, 6), flat('#7a2f24'));
    cap.position.set(x!, 3.6, z!);
    island.add(cap);
  }
  const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 4), flat('#3a2b1c'));
  flagPole.position.set(0, 4.3, 0);
  island.add(flagPole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.4), new THREE.MeshStandardMaterial({ color: '#e8743b', side: THREE.DoubleSide, flatShading: true }));
  flag.position.set(0.36, 4.8, 0);
  island.add(flag);
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + Math.random() * 0.2;
    const r = 3.4 + Math.random() * 2;
    const pine = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.3 + Math.random() * 0.6, 6), flat(i % 3 ? '#2f5a33' : '#3f6b3a'));
    pine.position.set(Math.cos(a) * r, 1.6, Math.sin(a) * r);
    island.add(pine);
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.3), flat('#86837b'));
    wall.position.set(Math.cos(a) * 2.4, 1.2, Math.sin(a) * 2.4);
    wall.rotation.y = -a;
    island.add(wall);
  }
  scene.add(island);
  // embers
  const n = 220;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 30;
    pos[i * 3 + 1] = Math.random() * 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const embers = new THREE.Points(g, new THREE.PointsMaterial({ color: '#ffb35c', size: 0.09, transparent: true, opacity: 0.9 }));
  scene.add(embers);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true;
  new IntersectionObserver(([e]) => (visible = !!e?.isIntersecting)).observe(canvas);
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = w / h < 0.8 ? 55 : 38;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();
  let t = 0;
  let last = performance.now();
  const loop = () => {
    requestAnimationFrame(loop);
    if (!visible) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduce) t += dt;
    const r = 17;
    camera.position.set(Math.cos(t * 0.08) * r, 7 + Math.sin(t * 0.2) * 0.6, Math.sin(t * 0.08) * r);
    camera.lookAt(0, 1.6, 0);
    flag.rotation.y = Math.sin(t * 3) * 0.25;
    const p = embers.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      let y = p.getY(i) + dt * 0.8;
      if (y > 12) y = 0;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    renderer.render(scene, camera);
  };
  loop();
}

hero(document.getElementById('hero3d') as HTMLCanvasElement);
