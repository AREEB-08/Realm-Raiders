import Phaser from 'phaser';
import {
  canDeploy,
  createBattle,
  resultOf,
  step,
  type Action,
  type BattleInput,
  type BattleState,
  type Projectile,
  type Troop,
} from '@realm/battle-engine';
import { MAX_TICKS } from '@realm/battle-engine';
import { TROOP_IDS, type TroopId } from '@realm/game-data';
import { sfx } from '../audio/sfx';
import { haptics } from '../ui/lib/native';
import { FACTION_BANNERS, paintProjectile, paintPuff, paintTroop } from './art';
import { bus, type BattleSnapshot } from './bus';
import { troopArt } from './baked';
import { ANCHOR_Y, ANIM_START, DIR8, dir8Of } from '../three/bake-layout';
import { buildingTexture, ensureTexture, IsoScene, pts, rubbleTexture, unflash } from './IsoScene';
import { footprintScreen, iso, isoInto } from './iso';
import { RenderInterpolation } from './render/render-interpolation';
import { unitDepth } from './render/unit-depth';

export interface BattleOptions {
  input: BattleInput;
  /** Plan actions to play automatically (the recorded input is built from what is applied). */
  autoplay: Action[];
  autoplayOn: boolean;
  speed: 1 | 2;
  replay: boolean;
  defenderBanner?: string;
  generalTexture?: string | null;
  /** Watch a friend's raid live: never run past the attacker's last reported tick. */
  spectate?: { until: number };
}

interface TroopView {
  id: number;
  x: number;
  y: number;
}

const LOG_LINES: Partial<Record<string, string>> = {
  citadel: 'The Citadel falls!',
  wall: 'Wall breached!',
  bowtower: 'A Bowyer Tower is down.',
  stonethrower: 'The Stonethrower is silenced.',
  obelisk: 'The Rune Obelisk shatters!',
  ballista: 'The Wyrm Ballista is broken.',
};

/** Live Battle (07) and replays (08): the engine at 20 Hz, Phaser only interpolates. */
export class BattleScene extends IsoScene {
  private opts!: BattleOptions;
  private state!: BattleState;
  private queue: Action[] = [];
  private manual: Action[] = [];
  private acc = 0;
  private speed: 1 | 2 = 1;
  private paused = false;
  private autoplayOn = true;
  private selected: TroopId | null = null;
  private lastDeployTile = '';
  private lastHoldDeploy = 0;
  private bSprites = new Map<number, Phaser.GameObjects.Image>();
  private tSprites = new Map<number, Phaser.GameObjects.Image>();
  private pSprites = new Map<number, Phaser.GameObjects.Image>();
  private bars!: Phaser.GameObjects.Graphics;
  private fxG!: Phaser.GameObjects.Graphics;
  private zone?: Phaser.GameObjects.Graphics;
  private beams: { from: number; to: number; until: number; stage: number }[] = [];
  private interp = new RenderInterpolation((x, y, out) => isoInto(out, x, y));
  private view: { units: TroopView[] } = { units: [] };
  private snapAt = 0;
  private finished = false;
  private tmp = { x: 0, y: 0 };
  private hitAt = new Map<number, number>();
  /** Ground shadows under flying troops (so the Dragon reads as airborne). */
  private shadows = new Map<number, Phaser.GameObjects.Ellipse>();
  private until = Number.POSITIVE_INFINITY;

  constructor() {
    super('battle');
  }

  init(opts: BattleOptions) {
    this.opts = opts;
    this.speed = opts.speed;
    this.autoplayOn = opts.autoplayOn;
    this.queue = [...opts.autoplay].sort((a, b) => a.t - b.t);
    this.until = opts.spectate ? opts.spectate.until : Number.POSITIVE_INFINITY;
    this.manual = [];
    this.acc = 0;
    this.paused = false;
    this.selected = null;
    this.finished = false;
    this.beams = [];
    this.bSprites = new Map();
    this.tSprites = new Map();
    this.pSprites = new Map();
    this.shadows = new Map();
    this.hitAt = new Map();
    this.view = { units: [] };
    this.interp = new RenderInterpolation((x, y, out) => isoInto(out, x, y));
  }

  create() {
    this.buildStage('day');
    this.state = createBattle({ ...this.opts.input, actions: [] });
    for (const t of TROOP_IDS) ensureTexture(this, `t:${t}`, () => paintTroop(t));
    for (const k of ['arrow', 'stone', 'bolt', 'fire', 'spark'] as const) ensureTexture(this, `p:${k}`, () => paintProjectile(k));
    ensureTexture(this, 'puff', paintPuff);
    const banner = this.opts.defenderBanner ?? FACTION_BANNERS.npc!;
    for (const b of this.state.buildings) {
      const tex = buildingTexture(this, b.type, b.level, banner);
      const fp = footprintScreen(b.x, b.y, b.size);
      const s = this.add.image(fp.cx, fp.cy, tex.key).setOrigin(tex.originX, tex.originY).setScale(tex.scale).setDepth(fp.depth);
      if (b.trap) s.setVisible(false);
      this.bSprites.set(b.id, s);
    }
    this.bars = this.add.graphics().setDepth(7600);
    this.fxG = this.add.graphics().setDepth(8000);
    this.setupInput();
    this.frameBase(this.state.buildings.filter((b) => !b.trap).map((b) => ({ x: b.x, y: b.y, size: b.size })));
    this.events.once('shutdown', () => {
      this.bSprites.clear();
      this.tSprites.clear();
      this.pSprites.clear();
    });
    this.emitSnapshot(true);
  }

  // ------------------------------------------------------------- controls ---

  select(troop: TroopId | null) {
    this.selected = troop;
    this.drawZone();
  }
  setSpeed(s: 1 | 2) {
    this.speed = s;
  }
  setPaused(p: boolean) {
    this.paused = p;
  }
  /** Take control: drop the rest of the plan; the player deploys from here. */
  setAutoplay(on: boolean) {
    this.autoplayOn = on;
    if (!on) this.queue = this.queue.filter((a) => a.t < this.state.tick);
    else {
      const appliedTroops = this.state.deployed;
      // Resume the plan from now, skipping troops already spent.
      const left = TROOP_IDS.map((_, i) => this.state.remaining[i]!);
      this.queue = this.opts.autoplay
        .filter((a) => a.t >= this.state.tick || a.kind !== 'deploy')
        .filter((a) => {
          if (a.kind !== 'deploy') return a.kind === 'rally' ? !this.state.rallyUsed : false;
          const i = TROOP_IDS.indexOf(a.troop);
          if (left[i]! <= 0) return false;
          left[i]!--;
          return true;
        })
        .map((a) => ({ ...a, t: Math.max(a.t, this.state.tick) }));
      void appliedTroops;
    }
  }
  /** Spectating: more of the attacker's applied actions, and how far the battle may now run. */
  feed(actions: Action[], until: number) {
    this.queue.push(...actions);
    this.queue.sort((a, b) => a.t - b.t);
    this.until = Math.max(this.until, until);
  }

  /** The attacker's side of a live raid: the tick and every action applied so far. */
  live() {
    return this.state ? { tick: this.state.tick, applied: this.state.applied, ended: this.state.ended } : null;
  }

  rally() {
    this.manual.push({ t: this.state.tick, kind: 'rally' });
  }
  end() {
    this.manual.push({ t: this.state.tick, kind: 'end' });
  }

  private drawZone() {
    this.zone?.destroy();
    this.zone = undefined;
    if (!this.selected || this.opts.replay) return;
    const g = this.add.graphics().setDepth(-700);
    g.fillStyle(0xd9573f, 0.22);
    const w = this.state.gridW;
    for (let y = 0; y < this.state.gridH; y++)
      for (let x = 0; x < w; x++) {
        if (!this.state.noDeploy[y * w + x]) continue;
        g.fillPoints(pts([iso(x, y), iso(x + 1, y), iso(x + 1, y + 1), iso(x, y + 1)]), true, true);
      }
    this.zone = g;
  }

  // ---------------------------------------------------------------- input ---

  private tryDeploy(p: Phaser.Input.Pointer) {
    if (!this.selected || this.opts.replay || this.state.ended) return false;
    const { tile } = this.tileAt(p);
    const x10 = Math.round(tile.x * 10);
    const y10 = Math.round(tile.y * 10);
    const key = `${Math.floor(x10 / 4)}:${Math.floor(y10 / 4)}`;
    if (!canDeploy(this.state, this.selected, x10, y10)) {
      const left = this.state.remaining[TROOP_IDS.indexOf(this.selected)]!;
      bus.emit('deploy-fail', { reason: left <= 0 ? 'None left in the camp.' : 'Too close to the walls — deploy on the red-free ground.' });
      return false;
    }
    if (key === this.lastDeployTile && performance.now() - this.lastHoldDeploy < 400) return false;
    this.lastDeployTile = key;
    this.lastHoldDeploy = performance.now();
    if (this.autoplayOn) this.setAutoplay(false);
    this.manual.push({ t: this.state.tick, kind: 'deploy', troop: this.selected, x: x10, y: y10 });
    // Reserve it locally so a fast stream cannot overspend before the next tick.
    this.state.remaining[TROOP_IDS.indexOf(this.selected)]!--;
    this.state.remainingTotal--;
    haptics.pulse('deploy');
    sfx.play('deploy');
    bus.emit('deploy-ok', { troop: this.selected });
    return true;
  }

  protected override onTap(p: Phaser.Input.Pointer): boolean {
    return this.tryDeploy(p);
  }

  /** Hold-to-deploy streams troops while the finger rests (cf. the reused hold-deploy). */
  protected override onHold(p: Phaser.Input.Pointer) {
    if (!this.selected) return;
    if (performance.now() - this.lastHoldDeploy < 130) return;
    this.lastDeployTile = '';
    this.tryDeploy(p);
  }

  protected override claimDrag(): boolean {
    // Dragging pans; with a troop selected and the finger held first, it streams deploys instead.
    return !!this.selected && !!this.down && performance.now() - this.down.t > 220;
  }

  protected override onDrag(p: Phaser.Input.Pointer) {
    if (performance.now() - this.lastHoldDeploy > 120) {
      this.lastDeployTile = '';
      this.tryDeploy(p);
    }
  }

  // ----------------------------------------------------------------- loop ---

  private captureView() {
    const units = this.view.units;
    units.length = 0;
    for (const t of this.state.troops) if (t.alive) units.push({ id: t.id, x: t.x / 1000, y: t.y / 1000 });
  }

  override update(_t: number, delta: number) {
    this.stepCamera(delta);
    if (!this.state) return;
    if (!this.paused && !this.state.ended) {
      this.acc += Math.min(delta, 250) * this.speed;
      while (this.acc >= 50 && !this.state.ended && this.state.tick < this.until) {
        this.captureView();
        this.interp.capture(this.view);
        const now: Action[] = [];
        while (this.queue.length && this.queue[0]!.t <= this.state.tick) now.push({ ...this.queue.shift()!, t: this.state.tick });
        // Manual actions were already "reserved"; give the counters back before the engine spends them.
        for (const a of this.manual) {
          if (a.kind === 'deploy') {
            this.state.remaining[TROOP_IDS.indexOf(a.troop)]!++;
            this.state.remainingTotal++;
          }
          now.push({ ...a, t: this.state.tick });
        }
        this.manual = [];
        step(this.state, now);
        this.handleFx();
        this.acc -= 50;
      }
      // Waiting for the attacker's next frames: don't bank time and then sprint.
      if (this.state.tick >= this.until) this.acc = Math.min(this.acc, 50);
    }
    this.captureView();
    this.interp.prepare(this.view, this.acc / 50);
    this.render();
    if (performance.now() - this.snapAt > 200) this.emitSnapshot(false);
    if (this.state.ended && !this.finished) {
      this.finished = true;
      this.emitSnapshot(true);
      const result = resultOf(this.state);
      if (result.stars > 0) sfx.play('victory');
      else sfx.play('defeat');
      haptics.pulse('victory');
      this.time.delayedCall(900, () =>
        bus.emit('battle-end', { result, input: { ...this.opts.input, actions: [...this.state.applied] } }),
      );
    }
  }

  private emitSnapshot(force: boolean) {
    if (!force && this.state.ended) return;
    this.snapAt = performance.now();
    const remaining: Partial<Record<TroopId, number>> = {};
    TROOP_IDS.forEach((t, i) => {
      const n = this.state.remaining[i]!;
      if (n > 0 || this.state.input.army.troops.some((e) => e.troop === t)) remaining[t] = n;
    });
    const g = this.state.generalId >= 0 ? this.state.troops[this.state.generalId] : null;
    const snap: BattleSnapshot = {
      tick: this.state.tick,
      secondsLeft: Math.max(0, Math.ceil((MAX_TICKS - this.state.tick) / 20)),
      destructionPct: this.state.destructionBp / 100,
      stars: this.state.stars,
      remaining,
      alive: this.state.troops.filter((t) => t.alive).length,
      generalAlive: !!g?.alive,
      rallyReady: !!g?.alive && !this.state.rallyUsed,
      rallyActive: this.state.tick < this.state.rallyUntil,
      events: this.state.events.slice(-6),
      ended: this.state.ended,
    };
    bus.emit('battle-tick', snap);
  }

  private handleFx() {
    for (const f of this.state.fx) {
      switch (f.k) {
        case 'hitB': {
          // A warm blush, at most every 220 ms per building — a white fill strobed under many
          // attackers and looked like the building had turned white.
          const s = this.bSprites.get(f.id);
          const now = this.time.now;
          if (s && now - (this.hitAt.get(f.id) ?? -1e9) > 220) {
            this.hitAt.set(f.id, now);
            s.setTint(0xffc9b0).setTintMode(Phaser.TintModes.MULTIPLY);
            this.time.delayedCall(110, () => s.active && this.state.buildings[f.id]?.alive && unflash(s));
          }
          break;
        }
        case 'destroyed': {
          const b = this.state.buildings[f.id]!;
          const s = this.bSprites.get(f.id);
          if (s) {
            const tex = rubbleTexture(this, b.size);
            s.setTexture(tex.key).setOrigin(tex.originX, tex.originY).setScale(1);
            unflash(s);
          }
          const fp = footprintScreen(b.x, b.y, b.size);
          this.puff(fp.cx, fp.cy - 20, 6 + b.size * 2, 0x8d8a83);
          if (!b.wall) this.cameras.main.shake(140, 0.003 * b.size);
          sfx.play(b.wall ? 'thud' : 'boom');
          haptics.pulse('destroy');
          const line = LOG_LINES[b.type];
          if (line) this.floatText(fp.cx, fp.cy - 60, line, '#ffd9a0');
          break;
        }
        case 'boom': {
          const p = iso(f.x / 1000, f.y / 1000);
          this.puff(p.x, p.y, 10, 0xffa040);
          sfx.play('boom');
          break;
        }
        case 'impact': {
          if (f.splash > 0) {
            const p = iso(f.x / 1000, f.y / 1000);
            const fire = f.kind === 'drake' || f.kind === 'mage';
            this.puff(p.x, p.y, 4, fire ? 0xff8a3c : 0xa09a90);
            if (fire) {
              // Fireball burst: a quick orange ring the size of the splash.
              const r = (f.splash / 1000) * 32;
              const g = this.add.graphics().setDepth(8060).setPosition(p.x, p.y).setBlendMode(Phaser.BlendModes.ADD);
              g.fillStyle(0xffb040, 0.55).fillEllipse(0, 0, r * 2, r);
              g.lineStyle(3, 0xfff0a0, 0.9).strokeEllipse(0, 0, r * 2, r);
              g.setScale(0.4);
              this.tweens.add({ targets: g, scale: 1.2, alpha: 0, duration: 320, onComplete: () => g.destroy() });
            }
          }
          break;
        }
        case 'shot': {
          // Each weapon its own voice: arrows and bolts whistle, fireballs whoosh, stones thump.
          const p = this.state.projectiles.find((x) => x.id === f.pid);
          const kind = p ? projKind(p) : 'stone';
          if (kind === 'arrow' || kind === 'bolt') sfx.play('arrow', kind === 'bolt' ? 0.9 : 0.6);
          else if (kind === 'fire') sfx.play('fireball', 0.7);
          else sfx.play('shot', 0.25);
          break;
        }
        case 'breath': {
          // Fire Dragon: a flickering cone from the dragon (in the air) to the target.
          const t = this.state.troops[f.id];
          if (!t) break;
          const spr = this.tSprites.get(f.id);
          const g0 = iso(t.x / 1000, t.y / 1000);
          // The mouth: a little above the sprite's middle (falls back to the ground point + lift).
          const a = spr ? { x: spr.x, y: spr.y - spr.displayHeight * 0.32 } : { x: g0.x, y: g0.y - 50 };
          const b = iso(f.x / 1000, f.y / 1000);
          const g = this.add.graphics().setDepth(8100).setBlendMode(Phaser.BlendModes.ADD);
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const nx = -dy / len;
          const ny = dx / len;
          const w = Math.min(46, len * 0.38);
          const jitter = () => (Math.random() - 0.5) * 10;
          for (const [scale, col, alpha] of [
            [1, 0xff4a12, 0.42],
            [0.62, 0xff9a2a, 0.55],
            [0.3, 0xffe9a0, 0.7],
          ] as const) {
            g.fillStyle(col, alpha);
            g.fillTriangle(a.x, a.y, b.x + nx * w * scale + jitter(), b.y + ny * w * scale + jitter(), b.x - nx * w * scale + jitter(), b.y - ny * w * scale + jitter());
          }
          g.fillStyle(0xffd27a, 0.5).fillEllipse(b.x, b.y, w * 1.6, w * 0.7);
          this.tweens.add({ targets: g, alpha: 0, duration: 360, onComplete: () => g.destroy() });
          this.puff(b.x, b.y, 5, 0xff8a3c);
          sfx.play('breath', 0.8);
          break;
        }
        case 'slam': {
          // Stone Giant: dust ring where the fists land, and a small camera shake.
          const p = iso(f.x / 1000, f.y / 1000);
          // Drawn at the origin and moved, so the ring grows about its own centre.
          const g = this.add.graphics().setDepth(8050).setPosition(p.x, p.y);
          g.lineStyle(6, 0xd8c8a0, 0.8).strokeEllipse(0, 0, 40, 20);
          this.tweens.add({ targets: g, scale: 2.2, alpha: 0, duration: 500, onComplete: () => g.destroy() });
          this.puff(p.x, p.y, 5, 0xc8b890);
          this.cameras.main.shake(120, 0.0025);
          sfx.play('slam', 0.8);
          break;
        }
        case 'swing': {
          // Sword slash: a quick white arc by the troop.
          const t = this.state.troops[f.id];
          if (!t) break;
          const a = iso(t.x / 1000, t.y / 1000);
          const g = this.add.graphics().setDepth(8050);
          g.lineStyle(3, 0xffffff, 0.9).beginPath();
          g.arc(a.x, a.y - 18, 16, -2.4, -0.6, false);
          g.strokePath();
          this.tweens.add({ targets: g, alpha: 0, duration: 180, onComplete: () => g.destroy() });
          sfx.play('swing', 0.5);
          break;
        }
        case 'beam': {
          this.beams.push({ from: f.from, to: f.to, until: this.state.tick + 4, stage: f.stage });
          break;
        }
        case 'trap': {
          const b = this.state.buildings[f.id]!;
          const s = this.bSprites.get(f.id);
          s?.setVisible(true).setAlpha(1);
          const fp = footprintScreen(b.x, b.y, 1);
          this.floatText(fp.cx, fp.cy - 30, 'Caltrops!', '#ff9a8a');
          sfx.play('thud');
          break;
        }
        case 'died': {
          const s = this.tSprites.get(f.id);
          if (s) {
            this.tSprites.delete(f.id);
            this.shadows.get(f.id)?.destroy();
            this.shadows.delete(f.id);
            const t = this.state.troops[f.id]!;
            const baked = troopArt(t.kind);
            if (baked && s.texture.key === baked.key) {
              // Play the 4 baked death frames, then fade.
              const row = DIR8[dir8Of(t.facing)]!.row;
              let i = 0;
              this.time.addEvent({
                delay: 90,
                repeat: 3,
                callback: () => s.active && s.setFrame(`${row}:${ANIM_START.death! + Math.min(3, i++)}`),
              });
              this.tweens.add({ targets: s, alpha: 0, delay: 420, duration: 380, onComplete: () => s.destroy() });
            } else this.tweens.add({ targets: s, alpha: 0, y: s.y - 10, duration: 400, onComplete: () => s.destroy() });
          }
          break;
        }
        case 'deploy': {
          const t = this.state.troops[f.id]!;
          const p = iso(t.x / 1000, t.y / 1000);
          this.puff(p.x, p.y, 3, 0xd8c8a0);
          break;
        }
        case 'rally': {
          const g = this.state.troops[f.id]!;
          const p = iso(g.x / 1000, g.y / 1000);
          const ring = this.add.ellipse(p.x, p.y, 20, 10).setStrokeStyle(4, 0xecc96b).setDepth(7900);
          this.tweens.add({ targets: ring, scaleX: 22, scaleY: 22, alpha: 0, duration: 900, onComplete: () => ring.destroy() });
          this.floatText(p.x, p.y - 50, 'Rally!', '#ecc96b');
          sfx.play('rally');
          break;
        }
      }
    }
  }

  private puff(x: number, y: number, n: number, tint: number) {
    for (let i = 0; i < n; i++) {
      const s = this.add
        .image(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 12, 'puff')
        .setTint(tint)
        .setDepth(7950)
        .setScale(0.4 + Math.random() * 0.5)
        .setAlpha(0.85);
      this.tweens.add({
        targets: s,
        y: s.y - 20 - Math.random() * 30,
        scale: s.scale * 1.8,
        alpha: 0,
        duration: 500 + Math.random() * 400,
        onComplete: () => s.destroy(),
      });
    }
  }

  private floatText(x: number, y: number, text: string, color: string) {
    const t = this.add
      .text(x, y, text, { fontFamily: 'Cinzel, serif', fontSize: '20px', color, stroke: '#140c05', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(9600);
    this.tweens.add({ targets: t, y: y - 40, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => t.destroy() });
  }

  private render() {
    const st = this.state;
    const alpha = this.acc / 50;
    // troops
    for (const t of st.troops) {
      if (!t.alive) continue;
      const baked = troopArt(t.kind);
      let s = this.tSprites.get(t.id);
      if (!s) {
        s = this.add.image(0, 0, `t:${t.kind}`).setOrigin(0.5, 0.9);
        this.tSprites.set(t.id, s);
      }
      this.interp.projectInto(this.tmp, t.x / 1000, t.y / 1000);
      if (baked) {
        // 3D-baked atlas: direction row (mirrored for E/SW/NE) × animation frame.
        if (s.texture.key !== baked.key) s.setTexture(baked.key, '0:0').setOrigin(0.5, ANCHOR_Y).setScale(baked.display).setAngle(0);
        const d = DIR8[dir8Of(t.facing)]!;
        s.setFrame(`${d.row}:${animColumn(t, st.tick)}`);
        s.setFlipX(d.flip);
        const bob = t.flies ? Math.sin((st.tick + alpha + t.id * 7) / 4) * 3 : 0;
        const lift = t.flies ? 26 : 0;
        if (t.kind === 'drake' && Math.abs(s.scaleX - baked.display * 1.35) > 1e-3) s.setScale(baked.display * 1.35);
        s.setPosition(this.tmp.x, this.tmp.y - lift - bob);
      } else {
        if (t.kind === 'general' && this.opts.generalTexture && this.textures.exists(this.opts.generalTexture) && s.texture.key !== this.opts.generalTexture)
          s.setTexture(this.opts.generalTexture).setDisplaySize(64, 64);
        const hover = t.flies ? 36 + Math.sin((st.tick + alpha + t.id * 7) / 4) * 3 : 0;
        s.setPosition(this.tmp.x, this.tmp.y - hover);
        // facing: indexes 5..11 point left on screen in iso
        const dir = t.facing;
        s.setFlipX(dir >= 3 && dir <= 9 ? true : false);
        if (t.moving && !t.flies) s.setAngle(Math.sin((st.tick + alpha) * 1.4 + t.id) * 4);
        else s.setAngle(0);
      }
      s.setDepth(unitDepth(this.tmp.y, t.id, t.flies));
      if (t.flies) {
        let sh = this.shadows.get(t.id);
        if (!sh) {
          sh = this.add.ellipse(0, 0, 54, 20, 0x000000, 0.28).setDepth(-10);
          this.shadows.set(t.id, sh);
        }
        sh.setPosition(this.tmp.x, this.tmp.y + 4).setVisible(true);
      }
      const hitAgo = st.tick - t.hitTick;
      if (hitAgo <= 1) s.setTint(0xff9a8a).setTintMode(Phaser.TintModes.MULTIPLY);
      else if (st.tick < st.rallyUntil && t.kind !== 'drake') s.setTint(0xffe9a0).setTintMode(Phaser.TintModes.MULTIPLY);
      else unflash(s);
    }
    // projectiles (+ trails drawn after the fx layer is cleared below)
    const trails: { x0: number; y0: number; x1: number; y1: number; fire: boolean }[] = [];
    const live = new Set<number>();
    for (const p of st.projectiles) {
      live.add(p.id);
      let s = this.pSprites.get(p.id);
      if (!s) {
        s = this.add.image(0, 0, `p:${projKind(p)}`).setDepth(7700);
        this.pSprites.set(p.id, s);
      }
      const span = Math.max(1, p.impactTick - p.fireTick);
      const f = Phaser.Math.Clamp((st.tick + alpha - p.fireTick) / span, 0, 1);
      let tx = p.x;
      let ty = p.y;
      if (p.homing && p.from === 'defence') {
        const target = st.troops[p.targetId];
        if (target) {
          tx = target.x;
          ty = target.y;
        }
      }
      const a = iso(p.sx / 1000, p.sy / 1000);
      const b = iso(tx / 1000, ty / 1000);
      const lift = p.from === 'defence' ? 40 : 18;
      const kind = projKind(p);
      const at = (k: number) => {
        const ak = (kind === 'stone' || kind === 'fire' ? Math.sin(k * Math.PI) * 60 : 0);
        return { x: a.x + (b.x - a.x) * k, y: a.y - lift * (1 - k) + (b.y - a.y) * k - ak };
      };
      const here = at(f);
      s.setPosition(here.x, here.y);
      s.setRotation(Math.atan2(b.y - a.y, b.x - a.x));
      if (kind === 'arrow' || kind === 'bolt' || kind === 'fire') {
        const back = at(Math.max(0, f - (kind === 'fire' ? 0.22 : 0.16)));
        trails.push({ x0: back.x, y0: back.y, x1: here.x, y1: here.y, fire: kind === 'fire' });
      }
    }
    for (const [id, s] of this.pSprites)
      if (!live.has(id)) {
        s.destroy();
        this.pSprites.delete(id);
      }
    // health bars + beams
    const g = this.bars.clear();
    for (const b of st.buildings) {
      if (!b.alive || b.trap || b.hp >= b.maxHp) continue;
      const fp = footprintScreen(b.x, b.y, b.size);
      const w = 18 + b.size * 10;
      const y = fp.cy - 40 - b.size * 14;
      g.fillStyle(0x0b0f12, 0.85).fillRect(fp.cx - w / 2 - 1, y - 1, w + 2, 6);
      g.fillStyle(b.wall ? 0xb0a890 : 0x6fbf73, 1).fillRect(fp.cx - w / 2, y, (w * b.hp) / b.maxHp, 4);
    }
    for (const t of st.troops) {
      if (!t.alive || t.hp >= t.maxHp) continue;
      this.interp.projectInto(this.tmp, t.x / 1000, t.y / 1000);
      const y = this.tmp.y - (t.flies ? 80 : 46);
      g.fillStyle(0x0b0f12, 0.85).fillRect(this.tmp.x - 11, y - 1, 22, 5);
      g.fillStyle(0xd9573f, 1).fillRect(this.tmp.x - 10, y, (20 * t.hp) / t.maxHp, 3);
    }
    const fx = this.fxG.clear();
    // Arrow / bolt trails and fireball glow (spec F6 effects).
    for (const tr of trails) {
      if (tr.fire) {
        fx.lineStyle(9, 0xff7a1a, 0.35).lineBetween(tr.x0, tr.y0, tr.x1, tr.y1);
        fx.lineStyle(4, 0xffd25a, 0.8).lineBetween(tr.x0, tr.y0, tr.x1, tr.y1);
        fx.fillStyle(0xff9a3a, 0.35).fillCircle(tr.x1, tr.y1, 11);
        fx.fillStyle(0xfff0b0, 0.9).fillCircle(tr.x1, tr.y1, 4);
      } else fx.lineStyle(2, 0xffffff, 0.45).lineBetween(tr.x0, tr.y0, tr.x1, tr.y1);
    }
    this.beams = this.beams.filter((bm) => bm.until > st.tick);
    for (const bm of this.beams) {
      const ob = st.buildings[bm.from];
      const tr = st.troops[bm.to];
      if (!ob || !tr || !tr.alive) continue;
      const a = iso(ob.cx / 1000, ob.cy / 1000);
      this.interp.projectInto(this.tmp, tr.x / 1000, tr.y / 1000);
      const width = 2 + bm.stage * 2;
      fx.lineStyle(width + 4, 0x8b6bc0, 0.35).lineBetween(a.x, a.y - 70, this.tmp.x, this.tmp.y - 16);
      fx.lineStyle(width, 0xe6dcff, 0.95).lineBetween(a.x, a.y - 70, this.tmp.x, this.tmp.y - 16);
    }
  }
}

/** Atlas column for a troop right now: attack swing, walk cycle or idle breathing. */
function animColumn(t: Troop, tick: number) {
  const since = tick - t.attackTick;
  const swing = Math.min(t.def.attackTicks, 12);
  if (since >= 0 && since < swing) return ANIM_START.attack! + Math.min(5, Math.floor((since * 6) / swing));
  if (t.moving) return ANIM_START.walk! + (Math.floor((tick + t.id * 3) / 2) % 8);
  return ANIM_START.idle! + (Math.floor((tick + t.id * 5) / 5) % 4);
}

function projKind(p: Projectile): 'arrow' | 'stone' | 'bolt' | 'fire' | 'spark' {
  if (p.ownerType === 'stonethrower') return 'stone';
  if (p.ownerType === 'ballista') return 'bolt';
  if (p.ownerType === 'drake' || p.ownerType === 'mage') return 'fire';
  return 'arrow';
}
