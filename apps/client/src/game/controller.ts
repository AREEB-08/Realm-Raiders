import Phaser from 'phaser';
import type { Action } from '@realm/battle-engine';
import { BattleScene, type BattleOptions } from './BattleScene';
import { IslandScene, type IslandData } from './IslandScene';
import { configureDisplay } from './render/display';
import { loadBuildingArt } from './bakedBuildings';
import { runtimeBudget } from './render/runtime-budget';

/**
 * Owns the single Phaser game for the whole session (§8.3). React screens drive it through
 * these methods; it never re-creates on React re-renders.
 */
class GameController {
  game: Phaser.Game | null = null;
  private parent: HTMLElement | null = null;
  private pendingIsland: IslandData | null = null;

  mount(parent: HTMLElement) {
    if (this.game) {
      if (this.parent !== parent) parent.appendChild(this.game.canvas);
      this.parent = parent;
      return;
    }
    this.parent = parent;
    // Adapted from the reused main.ts Phaser config: WebGL, Scale.NONE + display sizing, 3 pointers.
    this.game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent,
      transparent: true,
      scale: { mode: Phaser.Scale.NONE, width: Math.max(1, parent.clientWidth), height: Math.max(1, parent.clientHeight) },
      fps: { target: 60, limit: runtimeBudget.playFps || 0 },
      input: { activePointers: 3 },
      render: { antialias: true, roundPixels: false, powerPreference: 'high-performance' },
      scene: [IslandScene, BattleScene],
      banner: false,
      callbacks: {
        postBoot: (game) => {
          configureDisplay(game);
          game.scene.start('island');
          game.scene.stop('battle');
        },
      },
    });
    this.game.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
    // Start loading the 3D building baker right away (the island redraws when it is ready).
    void loadBuildingArt();
  }

  private get island() {
    return this.game?.scene.getScene('island') as IslandScene | undefined;
  }

  get battle() {
    return this.game?.scene.getScene('battle') as BattleScene | undefined;
  }

  showIsland(d: IslandData) {
    this.pendingIsland = d;
    const g = this.game;
    if (!g) return;
    const run = () => {
      if (g.scene.isActive('battle')) g.scene.stop('battle');
      if (!g.scene.isActive('island')) {
        if (g.scene.isSleeping('island')) g.scene.wake('island');
        else g.scene.start('island');
      }
      this.island?.show(this.pendingIsland!);
    };
    if (g.isBooted) run();
    else g.events.once('ready', run);
  }

  startBattle(opts: BattleOptions) {
    const g = this.game;
    if (!g) return;
    const run = () => {
      if (g.scene.isActive('island')) g.scene.sleep('island');
      g.scene.stop('battle');
      g.scene.start('battle', opts);
    };
    if (g.isBooted) run();
    else g.events.once('ready', run);
  }

  stopBattle() {
    this.game?.scene.stop('battle');
  }

  /** Spectating a friend's raid: feed the streamed actions. */
  feedBattle(actions: Action[], until: number) {
    this.battle?.feed(actions, until);
  }

  /** Raiding a friend: what to stream (tick + actions applied so far). */
  battleLive() {
    return this.game?.scene.isActive('battle') ? (this.battle?.live() ?? null) : null;
  }

  /** +/− buttons: smooth zoom of whichever map is on screen. */
  zoomBy(factor: number) {
    const g = this.game;
    if (!g) return;
    (g.scene.isActive('battle') ? this.battle : this.island)?.zoomBy(factor);
  }

  /** Dev/e2e probe of the active scene (camera zoom, tile → screen). Not exposed in release builds. */
  probe() {
    const g = this.game;
    if (!g) return null;
    const scene = g.scene.isActive('battle') ? this.battle : this.island;
    if (!scene) return null;
    return {
      scene: scene.scene.key,
      ...scene.probe(),
      isFree: (x: number, y: number) => this.island?.isFree(x, y) ?? false,
      buildings: () => this.island?.probeBuildings() ?? [],
    };
  }

  /** Pause rendering while a Three.js screen owns the GPU (§8.3). */
  sleep(on: boolean) {
    if (!this.game) return;
    if (on) this.game.loop.sleep();
    else this.game.loop.wake();
  }
}

export const gameCtl = new GameController();

// Playwright and chrome://inspect read the camera through this; release builds never define it.
if (import.meta.env.DEV || import.meta.env.VITE_E2E === '1')
  (window as unknown as { __rr: unknown }).__rr = {
    probe: () => gameCtl.probe(),
    /** Which troops have baked 3D atlases (e2e / chrome://inspect). */
    art: async () => {
      const { troopArt } = await import('./baked');
      const { TROOP_IDS } = await import('@realm/game-data');
      return TROOP_IDS.filter((t) => !!troopArt(t));
    },
    /** A baked atlas as a PNG data URL (visual checks). */
    atlas: (kind: string) => {
      const tex = gameCtl.game?.textures.get(`troop3d:${kind}`);
      const src = tex?.getSourceImage() as HTMLCanvasElement | undefined;
      return src && 'toDataURL' in src ? src.toDataURL('image/png') : null;
    },
  };
