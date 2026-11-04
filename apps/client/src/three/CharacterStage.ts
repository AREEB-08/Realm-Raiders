import * as THREE from 'three';
import type { Appearance } from '@realm/shared';
import { animateGeneral, buildGeneral, disposeTree, type GeneralRig } from './general';

/**
 * Three.js stage for the creator (02) and profile turntable (12). Its own canvas, DPR ≤ 1.5,
 * only alive while the screen is open (Phaser sleeps meanwhile, §8.3).
 */
export class CharacterStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private rig: GeneralRig | null = null;
  private pedestal: THREE.Mesh;
  private raf = 0;
  private t = 0;
  private yaw = 0.5;
  private spin = 0.35;
  private dragging: { x: number; yaw: number } | null = null;
  private observer: ResizeObserver;
  private lastTime = performance.now();
  private flagUp = 0;

  /**
   * `scrollable`: the stage sits inside a scrolling page (Profile). Vertical swipes then scroll
   * the page and only sideways drags turn the General.
   */
  constructor(
    private readonly host: HTMLElement,
    opts: { scrollable?: boolean } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.45, 5.2);
    this.camera.lookAt(0, 1.05, 0);
    this.scene.add(new THREE.HemisphereLight('#bfe0ff', '#3a2a1a', 1.2));
    const key = new THREE.DirectionalLight('#ffe2b8', 2.4);
    key.position.set(2.5, 4, 3);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight('#7fd4d0', 2.2);
    rim.position.set(-3, 2.5, -3);
    this.scene.add(rim);
    this.pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.9, 1.0, 0.18, 10),
      new THREE.MeshStandardMaterial({ color: '#3a4a54', flatShading: true, roughness: 0.9 }),
    );
    this.pedestal.position.y = -0.09;
    this.pedestal.receiveShadow = true;
    this.scene.add(this.pedestal);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.03, 4, 24), new THREE.MeshStandardMaterial({ color: '#c9a24a', metalness: 0.8, roughness: 0.3 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    const el = this.renderer.domElement;
    el.style.touchAction = opts.scrollable ? 'pan-y' : 'none';
    el.addEventListener('pointerdown', (e) => {
      this.dragging = { x: e.clientX, yaw: this.yaw };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (this.dragging) this.yaw = this.dragging.yaw + (e.clientX - this.dragging.x) * 0.012;
    });
    el.addEventListener('pointerup', () => (this.dragging = null));
    el.addEventListener('pointercancel', () => (this.dragging = null));
    this.loop();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setAppearance(a: Appearance) {
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeTree(this.rig.root);
    }
    this.rig = buildGeneral(a);
    (this.pedestal.material as THREE.MeshStandardMaterial).color.set(a.colors.primary).multiplyScalar(0.55);
    this.scene.add(this.rig.root);
  }

  setSpin(speed: number) {
    this.spin = speed;
  }

  /** "Raise your banner" flourish while minting. */
  celebrate() {
    this.flagUp = 1;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this.t += dt;
    if (!this.dragging) this.yaw += this.spin * dt;
    if (this.rig) {
      this.rig.root.rotation.y = this.yaw;
      animateGeneral(this.rig, this.t);
      if (this.flagUp > 0) {
        this.flagUp = Math.max(0, this.flagUp - dt * 0.5);
        this.rig.rightArm.rotation.x = -2.6 * Math.min(1, (1 - this.flagUp) * 3);
        this.rig.root.position.y = Math.sin((1 - this.flagUp) * Math.PI) * 0.15;
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    if (this.rig) disposeTree(this.rig.root);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}

function offscreen(size: number) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#bfe0ff', '#3a2a1a', 1.3));
  const key = new THREE.DirectionalLight('#ffe2b8', 2.6);
  key.position.set(2.5, 4, 3);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#7fd4d0', 2.6);
  rim.position.set(-3, 2.5, -3);
  scene.add(rim);
  return { renderer, scene };
}

/** 512×512 3/4 portrait with a soft rim light (§12.4) → PNG base64 (no data: prefix). */
export function renderPortrait(a: Appearance): string {
  const { renderer, scene } = offscreen(512);
  const rig = buildGeneral(a);
  rig.root.rotation.y = 0.45;
  scene.add(rig.root);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  cam.position.set(0.25, 1.75, 2.6);
  cam.lookAt(0, 1.55, 0);
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  disposeTree(rig.root);
  renderer.dispose();
  renderer.forceContextLoss();
  return url.replace(/^data:image\/png;base64,/, '');
}

/**
 * Runtime General sprite for battle (§12.4, cut-list item 4 simplified): one iso-angle frame
 * (elevation 30°, azimuth 45°), 128 px, used with horizontal flip for facing.
 */
export function bakeGeneralSprite(a: Appearance): HTMLCanvasElement {
  const { renderer, scene } = offscreen(128);
  const rig = buildGeneral(a);
  rig.root.rotation.y = Math.PI / 4;
  scene.add(rig.root);
  const cam = new THREE.OrthographicCamera(-1.1, 1.1, 2.3, 0, 0.1, 20);
  const r = 6;
  cam.position.set(r * Math.cos(Math.PI / 6), 1.1 + r * Math.sin(Math.PI / 6), 0);
  cam.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  cam.lookAt(0, 1.1, 0);
  cam.top = 1.3;
  cam.bottom = -1.15;
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const out = document.createElement('canvas');
  out.width = out.height = 128;
  out.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
  disposeTree(rig.root);
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}
