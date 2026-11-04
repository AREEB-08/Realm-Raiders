import * as THREE from 'three';

/**
 * The Stormwyrm Kaal (§11 screen 11): an original serpentine storm-drake built from primitives.
 * A chain of scaled segments follows a travelling wave; two membrane wings flap; the left wing
 * glows during the weak-point window. Hits flash and shake; lightning cracks now and then.
 */
export class BossStage {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private segments: THREE.Mesh[] = [];
  private head = new THREE.Group();
  private wingL: THREE.Mesh;
  private wingR: THREE.Mesh;
  private wingMat: THREE.MeshStandardMaterial;
  private bodyMat: THREE.MeshStandardMaterial;
  private ambient: THREE.AmbientLight;
  private rain: THREE.Points;
  private raf = 0;
  private t = 0;
  private last = performance.now();
  private flash = 0;
  private shake = 0;
  private weak = false;
  private dead = false;
  private observer: ResizeObserver;
  private base = new THREE.Vector3(0.9, 1.6, 9);

  constructor(private readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    Object.assign(this.renderer.domElement.style, { width: '100%', height: '100%', display: 'block' });
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 9);
    this.camera.lookAt(0, 1.4, 0);
    this.ambient = new THREE.AmbientLight('#5a6a9a', 0.9);
    this.scene.add(this.ambient);
    const key = new THREE.DirectionalLight('#cfe3ff', 2.2);
    key.position.set(3, 6, 5);
    this.scene.add(key);
    const ember = new THREE.PointLight('#ff8a3c', 18, 12);
    ember.position.set(0, 0, 3);
    this.scene.add(ember);
    this.bodyMat = new THREE.MeshStandardMaterial({ color: '#2f4a6a', flatShading: true, roughness: 0.6, metalness: 0.2 });
    const belly = new THREE.MeshStandardMaterial({ color: '#8fb2c9', flatShading: true, roughness: 0.7 });
    for (let i = 0; i < 18; i++) {
      const r = 0.55 * (1 - i / 22);
      const seg = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), i % 3 === 0 ? belly : this.bodyMat);
      this.segments.push(seg);
      this.scene.add(seg);
      if (i % 2 === 0) {
        const spine = new THREE.Mesh(new THREE.ConeGeometry(r * 0.35, r * 0.9, 4), new THREE.MeshStandardMaterial({ color: '#c9d6e8', flatShading: true }));
        spine.position.y = r * 0.9;
        seg.add(spine);
      }
    }
    // head
    const skull = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 6), this.bodyMat);
    skull.rotation.z = Math.PI / 2;
    this.head.add(skull);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.5), belly);
    jaw.position.set(0.25, -0.3, 0);
    this.head.add(jaw);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.9, 5), new THREE.MeshStandardMaterial({ color: '#e8e0c8', flatShading: true }));
      horn.position.set(-0.3, 0.45, side * 0.25);
      horn.rotation.z = 0.9;
      this.head.add(horn);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 5), new THREE.MeshStandardMaterial({ color: '#9fe6ff', emissive: '#7fd4ff', emissiveIntensity: 3 }));
      eye.position.set(0.15, 0.12, side * 0.3);
      this.head.add(eye);
    }
    this.scene.add(this.head);
    // wings
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0);
    wingShape.lineTo(3.2, 1.6);
    wingShape.lineTo(2.6, 0.6);
    wingShape.lineTo(3.0, -0.2);
    wingShape.lineTo(1.8, -0.4);
    wingShape.lineTo(1.9, -1.1);
    wingShape.lineTo(0.6, -0.5);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    this.wingMat = new THREE.MeshStandardMaterial({ color: '#3d5f86', side: THREE.DoubleSide, flatShading: true, emissive: '#000000', transparent: true, opacity: 0.92 });
    this.wingL = new THREE.Mesh(wingGeo, this.wingMat.clone());
    this.wingR = new THREE.Mesh(wingGeo, this.wingMat);
    this.wingR.scale.x = -1;
    this.scene.add(this.wingL, this.wingR);
    // rain
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = Math.random() * 12 - 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 8;
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.Points(rg, new THREE.PointsMaterial({ color: '#9fb8d9', size: 0.05, transparent: true, opacity: 0.6 }));
    this.scene.add(this.rain);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    this.loop();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Fit the whole wyrm (about 8.6 units nose to tail) across the screen width.
    const halfW = 4.6;
    const z = Math.max(9, halfW / (Math.tan((this.camera.fov * Math.PI) / 360) * this.camera.aspect));
    this.base.set(0.9, 1.6, z);
    this.camera.position.copy(this.base);
    this.camera.lookAt(0.9, 1.4, 0);
    this.camera.updateProjectionMatrix();
  }

  hit(strong: boolean) {
    this.flash = strong ? 1 : 0.5;
    this.shake = strong ? 0.25 : 0.1;
  }

  setWeak(on: boolean) {
    this.weak = on;
  }

  setDefeated(on: boolean) {
    this.dead = on;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    const t = this.t;
    const sink = this.dead ? Math.min(4, (this.t % 1000) * 0) : 0;
    // body: a travelling wave
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i]!;
      const u = i / this.segments.length;
      s.position.set(-2.6 + i * 0.42, 1.6 + Math.sin(t * 2 - i * 0.55) * 0.55 * (0.4 + u) - (this.dead ? u * 2 : 0) - sink, Math.cos(t * 1.4 - i * 0.4) * 0.6 * u);
      s.rotation.set(t * 0.3 + i, t * 0.2, 0);
    }
    const h0 = this.segments[0]!.position;
    this.head.position.set(h0.x - 0.75, h0.y + 0.1, h0.z);
    this.head.rotation.set(0, Math.PI, Math.sin(t * 2) * 0.15 + (this.dead ? -0.8 : 0));
    const anchor = this.segments[3]!.position;
    const flap = Math.sin(t * (this.weak ? 5 : 3)) * 0.55;
    this.wingL.position.set(anchor.x, anchor.y + 0.2, anchor.z + 0.2);
    this.wingR.position.set(anchor.x, anchor.y + 0.2, anchor.z - 0.2);
    this.wingL.rotation.set(-0.5 + flap, -0.3, 0.2);
    this.wingR.rotation.set(0.5 - flap, 0.3, 0.2);
    const wl = this.wingL.material as THREE.MeshStandardMaterial;
    wl.emissive.set(this.weak ? '#ff7a3d' : '#000000');
    wl.emissiveIntensity = this.weak ? 1.4 + Math.sin(t * 12) * 0.6 : 0;
    // hit flash + lightning
    this.bodyMat.emissive.setRGB(this.flash, this.flash, this.flash);
    this.bodyMat.emissiveIntensity = this.flash;
    this.flash = Math.max(0, this.flash - dt * 6);
    const strike = Math.random() < dt * 0.25;
    this.ambient.intensity = strike ? 4 : 0.9 + this.flash * 0.5;
    this.camera.position.x = this.base.x + (Math.random() - 0.5) * this.shake;
    this.camera.position.y = this.base.y + (Math.random() - 0.5) * this.shake;
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const p = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i) - dt * 9;
      if (y < -3) y = 10;
      p.setY(i, y);
    }
    p.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
