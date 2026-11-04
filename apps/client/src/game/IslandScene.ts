import Phaser from 'phaser';
import { BUILDINGS, type BuildingId, type Layout, type LayoutBuilding } from '@realm/game-data';
import { canPlace, occupancy, type WallTile } from '@realm/core';
import type { EconomyDTO, LayoutMove, UpgradeTimer } from '@realm/shared';
import { bus } from './bus';
import { haptics } from '../ui/lib/native';
import { FACTION_BANNERS } from './art';
import { buildingTexture, IsoScene, unflash, type Look } from './IsoScene';
import { onBuildingArt } from './bakedBuildings';
import { footprintScreen, iso } from './iso';
import { wallLine } from './walls';

export { wallLine };

export type IslandMode = 'home' | 'edit' | 'preview';

export interface IslandData {
  layout: Layout;
  mode: IslandMode;
  look?: Look;
  faction?: string;
  economy?: EconomyDTO | null;
  timers?: UpgradeTimer[];
  selectedId?: string | null;
  ghostMoves?: LayoutMove[] | null;
  placing?: BuildingId | null;
  /** Where the building being placed stands as a ghost (React moves it; ✓ builds it). */
  placeAt?: { x: number; y: number } | null;
  wallTool?: boolean;
  /** Wall line waiting for Confirm: ghost walls (green = will be placed, red = can't). */
  wallDraft?: WallTile[] | null;
  /** Plans a line while the finger is still down (same rules as the confirm bar). */
  planWalls?: ((tiles: { x: number; y: number }[]) => WallTile[]) | null;
  focus?: { x: number; y: number } | null;
}

const RES_COLORS = { gold: 0xf2c14e, timber: 0xc08a4e, ember: 0xff7a3d } as const;

/** Home island (03), the editor (04), night/dawn views (09/10) and scouting previews (05). */
export class IslandScene extends IsoScene {
  private data_: IslandData | null = null;
  private sprites = new Map<string, Phaser.GameObjects.Image>();
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private bubbles = new Map<string, Phaser.GameObjects.Container>();
  private ghosts: Phaser.GameObjects.GameObject[] = [];
  private wallGhosts: Phaser.GameObjects.Image[] = [];
  private overlay!: Phaser.GameObjects.Graphics;
  private tint?: Phaser.GameObjects.Rectangle;
  private drag: { id: string; offX: number; offY: number; x: number; y: number; ok: boolean } | null = null;
  /** Build mode: the building a long-press picked up (only a picked building can be dragged). */
  private picked: { id: string; offX: number; offY: number } | null = null;
  private placeGhost: Phaser.GameObjects.Image | null = null;
  /** Wall painting: the tiles the finger has passed over in this stroke (orthogonally joined). */
  private wallPath: { x: number; y: number }[] | null = null;
  private framed = false;
  private bob = 0;

  constructor() {
    super('island');
  }

  create() {
    this.buildStage('day');
    this.overlay = this.add.graphics().setDepth(9000);
    this.setupInput();
    this.frameCamera();
    this.events.on('shutdown', () => this.sprites.clear());
    // When the 3D building baker becomes ready, redraw the island with it.
    const off = onBuildingArt(() => {
      if (this.data_ && this.sys.isActive()) this.apply(this.data_);
    });
    this.events.once('destroy', off);
    if (this.data_) this.apply(this.data_);
    bus.emit('ready', undefined);
  }

  /** React → Phaser: show this island state. */
  show(d: IslandData) {
    const lookChanged = (d.look ?? 'day') !== this.look;
    const refocus = !this.framed || d.focus !== undefined || this.data_?.mode !== d.mode;
    this.data_ = d;
    if (!this.sys.isActive() && !this.sys.isSleeping()) return;
    if (lookChanged) {
      this.buildStage(d.look ?? 'day');
      this.applyTint();
    }
    this.apply(d);
    if (refocus) {
      this.framed = true;
      if (d.focus) this.frameCamera(iso(d.focus.x, d.focus.y), 1.3);
      else this.frameBase(d.layout.buildings.map((b) => ({ x: b.x, y: b.y, size: BUILDINGS[b.type].size })), d.mode === 'edit' ? 0.95 : 0.88);
    }
  }

  private applyTint() {
    this.tint?.destroy();
    if (this.look === 'day') return;
    // In world space (a screen-anchored rectangle shrinks with the camera zoom and left gaps).
    this.tint = this.add
      .rectangle(-3000, -3000, 9000, 8000, this.look === 'night' ? 0x101a4a : 0xff9a7a, this.look === 'night' ? 0.28 : 0.1)
      .setOrigin(0, 0)
      .setDepth(8500);
  }

  private apply(d: IslandData) {
    const banner = FACTION_BANNERS[d.faction ?? 'thornmarch'] ?? FACTION_BANNERS.thornmarch!;
    const seen = new Set<string>();
    for (const b of d.layout.buildings) {
      seen.add(b.id);
      const tex = buildingTexture(this, b.type, b.level, banner);
      const fp = footprintScreen(b.x, b.y, BUILDINGS[b.type].size);
      let s = this.sprites.get(b.id);
      if (!s) {
        s = this.add.image(fp.cx, fp.cy, tex.key);
        this.sprites.set(b.id, s);
      }
      s.setTexture(tex.key).setOrigin(tex.originX, tex.originY).setScale(tex.scale).setPosition(fp.cx, fp.cy).setDepth(fp.depth).setAlpha(1);
      unflash(s);
      if (b.type === 'caltrops') s.setAlpha(d.mode === 'edit' ? 0.9 : 0.55);
    }
    for (const [id, s] of this.sprites)
      if (!seen.has(id)) {
        s.destroy();
        this.sprites.delete(id);
      }
    this.syncTimers(d);
    this.syncBubbles(d);
    this.drawOverlay();
    this.drawGhosts(d);
  }

  private syncTimers(d: IslandData) {
    const timers = new Map((d.timers ?? []).map((t) => [t.buildingId, t]));
    for (const [id, label] of this.labels)
      if (!timers.has(id)) {
        label.destroy();
        this.labels.delete(id);
      }
    for (const [id, t] of timers) {
      const b = d.layout.buildings.find((x) => x.id === id);
      if (!b) continue;
      const fp = footprintScreen(b.x, b.y, BUILDINGS[b.type].size);
      let label = this.labels.get(id);
      if (!label) {
        label = this.add
          .text(fp.cx, fp.cy - 70, '', { fontFamily: 'Cinzel, serif', fontSize: '18px', color: '#ffe9b0', stroke: '#1a1208', strokeThickness: 4 })
          .setOrigin(0.5)
          .setDepth(9500);
        this.labels.set(id, label);
      }
      label.setPosition(fp.cx, fp.cy - 70);
      label.setData('readyAt', t.readyAt);
    }
  }

  private syncBubbles(d: IslandData) {
    const show = d.mode === 'home' && d.economy;
    const pending = new Map((show ? d.economy!.producers : []).map((p) => [p.buildingId, p]));
    for (const [id, c] of this.bubbles)
      if (!pending.has(id) || pending.get(id)!.pending < Math.max(1, pending.get(id)!.cap * 0.05)) {
        c.destroy();
        this.bubbles.delete(id);
      }
    for (const [id, p] of pending) {
      if (p.pending < Math.max(1, p.cap * 0.05)) continue;
      const b = d.layout.buildings.find((x) => x.id === id);
      if (!b) continue;
      const fp = footprintScreen(b.x, b.y, BUILDINGS[b.type].size);
      if (this.bubbles.has(id)) continue;
      const g = this.add.graphics();
      g.fillStyle(0x10181d, 0.9).fillCircle(0, 0, 17);
      g.lineStyle(3, 0xc9a24a, 1).strokeCircle(0, 0, 17);
      g.fillStyle(RES_COLORS[p.resource], 1).fillCircle(0, 0, 10);
      g.fillStyle(0xffffff, 0.5).fillCircle(-3, -3, 3);
      const c = this.add.container(fp.cx, fp.cy - 86, [g]).setDepth(9400);
      this.bubbles.set(id, c);
    }
  }

  private drawOverlay() {
    const d = this.data_;
    const g = this.overlay.clear();
    if (!d) return;
    const sel = d.selectedId ? d.layout.buildings.find((b) => b.id === d.selectedId) : null;
    if (sel && d.mode !== 'preview') {
      const pts = this.footprintOf(sel.type, sel.x, sel.y);
      g.lineStyle(3, 0xecc96b, 1).strokePoints(pts, true, true);
      const def = BUILDINGS[sel.type].defence;
      if (def) {
        const c = iso(sel.x + BUILDINGS[sel.type].size / 2, sel.y + BUILDINGS[sel.type].size / 2);
        const r = def.range / 1000;
        g.lineStyle(2, 0xecc96b, 0.6).strokeEllipse(c.x, c.y, r * 64 * Math.SQRT2, r * 32 * Math.SQRT2);
        if (def.minRange) g.lineStyle(2, 0xd9573f, 0.5).strokeEllipse(c.x, c.y, (def.minRange / 1000) * 64 * Math.SQRT2, (def.minRange / 1000) * 32 * Math.SQRT2);
      }
    }
    if (this.drag) {
      const b = d.layout.buildings.find((x) => x.id === this.drag!.id)!;
      const pts = this.footprintOf(b.type, this.drag.x, this.drag.y);
      g.fillStyle(this.drag.ok ? 0x6fbf73 : 0xd9573f, 0.35).fillPoints(pts, true, true);
      g.lineStyle(2, this.drag.ok ? 0x6fbf73 : 0xd9573f, 1).strokePoints(pts, true, true);
    }
    this.placeGhost?.destroy();
    this.placeGhost = null;
    if (d.placing && d.placeAt) {
      const at = d.placeAt;
      const ok = canPlace(occupancy(d.layout), d.placing, at.x, at.y);
      const pts = this.footprintOf(d.placing, at.x, at.y);
      g.fillStyle(ok ? 0x6fbf73 : 0xd9573f, 0.45).fillPoints(pts, true, true);
      g.lineStyle(3, ok ? 0xbff5b0 : 0xffb0a0, 1).strokePoints(pts, true, true);
      // The building itself, translucent, so you see what will stand there.
      const banner = FACTION_BANNERS[d.faction ?? 'thornmarch'] ?? FACTION_BANNERS.thornmarch!;
      const tex = buildingTexture(this, d.placing, 1, banner);
      const fp = footprintScreen(at.x, at.y, BUILDINGS[d.placing].size);
      this.placeGhost = this.add.image(fp.cx, fp.cy, tex.key).setOrigin(tex.originX, tex.originY).setScale(tex.scale).setDepth(9050).setAlpha(0.8);
      if (!ok) this.placeGhost.setTint(0xff8a7a);
    }
    this.drawWallGhosts(this.wallPath ? this.planLive(this.wallPath) : null);
  }

  /** Validity of a line while dragging (falls back to "free ground" when React gave no planner). */
  private planLive(tiles: { x: number; y: number }[]): WallTile[] {
    const d = this.data_!;
    if (d.planWalls) return d.planWalls(tiles);
    const occ = occupancy(d.layout);
    return tiles.map((t) => ({ ...t, state: canPlace(occ, 'wall', t.x, t.y) ? 'ok' : 'occupied' }));
  }

  /** Ghost walls along a line: translucent stone where a wall will rise, red tiles where it can't. */
  private drawWallGhosts(tiles: WallTile[] | null) {
    for (const s of this.wallGhosts) s.destroy();
    this.wallGhosts = [];
    if (!tiles?.length) return;
    const g = this.overlay;
    const banner = FACTION_BANNERS[this.data_?.faction ?? 'thornmarch'] ?? FACTION_BANNERS.thornmarch!;
    const tex = buildingTexture(this, 'wall', 1, banner);
    for (const t of tiles) {
      const ok = t.state === 'ok';
      const pts = this.footprintOf('wall', t.x, t.y);
      g.fillStyle(ok ? 0x6fbf73 : 0xd9573f, ok ? 0.35 : 0.5).fillPoints(pts, true, true);
      g.lineStyle(2, ok ? 0xbff5b0 : 0xffb0a0, 0.9).strokePoints(pts, true, true);
      if (!ok) continue;
      const fp = footprintScreen(t.x, t.y, 1);
      const s = this.add.image(fp.cx, fp.cy, tex.key).setOrigin(tex.originX, tex.originY).setScale(tex.scale).setDepth(fp.depth + 0.4).setAlpha(0.6).setTint(0xc8ffd0);
      this.wallGhosts.push(s);
    }
  }

  private drawGhosts(d: IslandData) {
    for (const o of this.ghosts) o.destroy();
    this.ghosts = [];
    if (!d.ghostMoves?.length) return;
    const banner = FACTION_BANNERS[d.faction ?? 'thornmarch']!;
    const g = this.add.graphics().setDepth(9200);
    this.ghosts.push(g);
    for (const m of d.ghostMoves) {
      const b = d.layout.buildings.find((x) => x.id === m.buildingId);
      if (!b) continue;
      const size = BUILDINGS[b.type].size;
      const tex = buildingTexture(this, b.type, b.level, banner);
      const fp = footprintScreen(m.x, m.y, size);
      const ghost = this.add.image(fp.cx, fp.cy, tex.key).setOrigin(tex.originX, tex.originY).setScale(tex.scale).setAlpha(0.55).setTint(0x9fe6ff).setDepth(fp.depth + 0.5);
      this.ghosts.push(ghost);
      this.tweens.add({ targets: ghost, alpha: 0.25, yoyo: true, repeat: -1, duration: 700 });
      const from = iso(b.x + size / 2, b.y + size / 2);
      const to = iso(m.x + size / 2, m.y + size / 2);
      g.lineStyle(4, 0x9fe6ff, 0.9).lineBetween(from.x, from.y, to.x, to.y);
      g.fillStyle(0x9fe6ff, 0.9).fillCircle(to.x, to.y, 7);
      g.fillStyle(0x9fe6ff, 0.35).fillPoints(this.footprintOf(b.type, m.x, m.y), true, true);
    }
  }

  // ------------------------------------------------------------------ input ---

  private buildingAt(tx: number, ty: number): LayoutBuilding | undefined {
    const d = this.data_;
    if (!d) return undefined;
    const x = Math.floor(tx);
    const y = Math.floor(ty);
    // Prefer non-trap buildings on the tile.
    const hits = d.layout.buildings.filter((b) => {
      const s = BUILDINGS[b.type].size;
      return x >= b.x && x < b.x + s && y >= b.y && y < b.y + s;
    });
    return hits.find((b) => b.type !== 'caltrops') ?? hits[0];
  }

  protected override onTap(p: Phaser.Input.Pointer): boolean {
    const d = this.data_;
    if (!d || d.mode === 'preview') return false;
    const { tile } = this.tileAt(p);
    if (d.mode === 'edit' && d.wallTool) {
      // Wall brush: a tap places one wall right there.
      bus.emit('wall-line', { tiles: [{ x: Math.floor(tile.x), y: Math.floor(tile.y) }] });
      return true;
    }
    if (d.mode === 'edit' && d.placing) {
      const size = BUILDINGS[d.placing].size;
      const x = Math.floor(tile.x - size / 2 + 0.5);
      const y = Math.floor(tile.y - size / 2 + 0.5);
      // Move the ghost here; the ✓ button builds it.
      bus.emit('place-move', { x, y });
      return true;
    }
    const b = this.buildingAt(tile.x, tile.y);
    const rect = this.game.canvas.getBoundingClientRect();
    const sx = rect.left + p.x / this.density;
    const sy = rect.top + p.y / this.density;
    if (d.mode === 'home') {
      if (b && this.bubbles.has(b.id)) {
        this.collectFx(b.id);
        bus.emit('collect', { id: b.id, sx, sy });
      } else if (b) bus.emit('building-tap', { id: b.id, sx, sy });
      return !!b;
    }
    bus.emit('building-select', { id: b?.id ?? null });
    return !!b;
  }

  /** Build mode: holding a finger on a building for 250 ms picks it up (then a drag moves it). */
  protected override onHold(_p: Phaser.Input.Pointer, heldMs: number) {
    const d = this.data_;
    if (!d || d.mode !== 'edit' || d.wallTool || d.placing || this.picked || !this.down || heldMs < 250) return;
    const start = this.tileAt({ x: this.down.x, y: this.down.y }).tile;
    const b = this.buildingAt(start.x, start.y);
    if (!b) return;
    this.picked = { id: b.id, offX: b.x - Math.floor(start.x), offY: b.y - Math.floor(start.y) };
    const s = this.sprites.get(b.id);
    if (s) {
      const fp = footprintScreen(b.x, b.y, BUILDINGS[b.type].size);
      s.setPosition(fp.cx, fp.cy - 10).setAlpha(0.9);
    }
    haptics.pulse('deploy');
    bus.emit('building-select', { id: b.id });
  }

  protected override onRelease() {
    if (!this.picked || this.drag) return;
    // Lifted but not moved: set it back down.
    this.picked = null;
    if (this.data_) this.apply(this.data_);
  }

  /** Test/dev probe: the buildings on screen (id, type, tile, size). */
  probeBuildings() {
    return (this.data_?.layout.buildings ?? []).map((b) => ({ id: b.id, type: b.type, x: b.x, y: b.y, size: BUILDINGS[b.type].size }));
  }

  /** Test/dev probe: can a 1×1 wall stand on this tile right now? */
  isFree(x: number, y: number) {
    const d = this.data_;
    return !!d && canPlace(occupancy(d.layout), 'wall', x, y);
  }

  private collectFx(id: string) {
    const c = this.bubbles.get(id);
    if (!c) return;
    this.bubbles.delete(id);
    this.tweens.add({ targets: c, y: c.y - 60, alpha: 0, scale: 1.4, duration: 450, onComplete: () => c.destroy() });
  }

  protected override claimDrag(_p: Phaser.Input.Pointer): boolean {
    const d = this.data_;
    if (!d || d.mode !== 'edit' || !this.down) return false;
    const start = this.tileAt({ x: this.down.x, y: this.down.y }).tile;
    if (d.wallTool) {
      // Wall brush: a one-finger drag paints walls along its path (two fingers still pan/zoom).
      this.wallPath = [{ x: Math.floor(start.x), y: Math.floor(start.y) }];
      return true;
    }
    // A plain drag always pans (spec F3): only a building picked up by a long-press moves.
    const picked = this.picked;
    if (!picked) return false;
    const b = d.layout.buildings.find((x) => x.id === picked.id);
    if (!b) return false;
    this.drag = { id: b.id, offX: picked.offX, offY: picked.offY, x: b.x, y: b.y, ok: true };
    return true;
  }

  protected override onDrag(p: Phaser.Input.Pointer) {
    const d = this.data_;
    if (!d) return;
    const { tile } = this.tileAt(p);
    if (this.wallPath) {
      const last = this.wallPath[this.wallPath.length - 1]!;
      const at = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
      if (at.x !== last.x || at.y !== last.y) {
        for (const t of wallLine(last, at).slice(1)) {
          // Join diagonal steps with a corner tile, so painted walls always connect.
          const prev = this.wallPath[this.wallPath.length - 1]!;
          if (prev.x !== t.x && prev.y !== t.y) this.wallPath.push({ x: t.x, y: prev.y });
          if (!this.wallPath.some((w) => w.x === t.x && w.y === t.y)) this.wallPath.push(t);
        }
        // Catch up on the other axis when the finger moved diagonally.
        const tail = this.wallPath[this.wallPath.length - 1]!;
        if (tail.x !== at.x || tail.y !== at.y)
          for (const t of wallLine(tail, at).slice(1)) if (!this.wallPath.some((w) => w.x === t.x && w.y === t.y)) this.wallPath.push(t);
        if (this.wallPath.length > 30) this.wallPath.length = 30;
        this.drawOverlay();
      }
      return;
    }
    if (d.placing) return;
    if (!this.drag) return;
    const b = d.layout.buildings.find((x) => x.id === this.drag!.id)!;
    const x = Math.floor(tile.x) + this.drag.offX;
    const y = Math.floor(tile.y) + this.drag.offY;
    this.drag.x = x;
    this.drag.y = y;
    this.drag.ok = canPlace(occupancy(d.layout, b.id), b.type, x, y);
    const s = this.sprites.get(b.id);
    if (s) {
      const fp = footprintScreen(x, y, BUILDINGS[b.type].size);
      s.setPosition(fp.cx, fp.cy - 6).setDepth(9100).setAlpha(0.85);
      if (this.drag.ok) unflash(s);
      else s.setTint(0xff8a7a);
    }
    this.drawOverlay();
  }

  protected override onDragEnd(_p: Phaser.Input.Pointer, cancelled: boolean) {
    const d = this.data_;
    if (!d) return;
    if (this.wallPath) {
      const tiles = this.wallPath;
      this.wallPath = null;
      this.drawOverlay();
      if (!cancelled && tiles.length) bus.emit('wall-line', { tiles });
      return;
    }
    if (d.placing) return;
    const drag = this.drag;
    this.drag = null;
    this.picked = null;
    if (!drag) return;
    const b = d.layout.buildings.find((x) => x.id === drag.id)!;
    if (!cancelled && drag.ok && (drag.x !== b.x || drag.y !== b.y)) {
      const layout = structuredClone(d.layout);
      const nb = layout.buildings.find((x) => x.id === drag.id)!;
      nb.x = drag.x;
      nb.y = drag.y;
      this.data_ = { ...d, layout };
      this.apply(this.data_);
      bus.emit('layout-change', { layout, movedId: drag.id });
    } else {
      if (!drag.ok && !cancelled) bus.emit('layout-invalid', { reason: 'That ground is taken or off the buildable area.' });
      this.apply(d);
    }
  }

  override update(_t: number, delta: number) {
    this.stepCamera(delta);
    this.bob += delta / 1000;
    for (const [, c] of this.bubbles) c.setScale(1 + Math.sin(this.bob * 3) * 0.06);
    const now = Date.now();
    for (const [, label] of this.labels) {
      const left = Math.max(0, Math.ceil(((label.getData('readyAt') as number) - now) / 1000));
      label.setText(left > 0 ? `⚒ ${left}s` : '✓');
    }
  }
}
