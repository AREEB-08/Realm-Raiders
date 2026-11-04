import type Phaser from 'phaser';
import type { TroopId } from '@realm/game-data';
import type { Appearance } from '@realm/shared';
import { artGet, artPut } from '../persist/artCache';

/**
 * Baked 3D army art (spec F6). On first launch every troop (and the player's own General) is
 * baked from its Three.js model into a sprite atlas — "Forging your army… 63%" — then stored in
 * IndexedDB; later launches just load the PNGs. Until an atlas is ready (or if WebGL baking
 * fails), battles keep the 2D drawings.
 */
export interface TroopArt {
  key: string;
  size: number;
  display: number;
}

const ARMY: TroopId[] = ['shield', 'longbow', 'sapper', 'ravager', 'mage', 'drake'];
const art = new Map<TroopId, TroopArt>();
let generalFor: string | null = null;

type Progress = { done: number; total: number; running: boolean; failed: boolean };
const progress: Progress = { done: 0, total: 0, running: false, failed: false };
const listeners = new Set<(p: Progress) => void>();
const emit = () => listeners.forEach((l) => l({ ...progress }));

export function onArtProgress(cb: (p: Progress) => void) {
  listeners.add(cb);
  cb({ ...progress });
  return () => {
    listeners.delete(cb);
  };
}

/** The baked atlas of a troop, if it is ready. */
export const troopArt = (kind: TroopId): TroopArt | undefined => art.get(kind);

const ROWS = 5;

function register(game: Phaser.Game, kind: TroopId, canvas: HTMLCanvasElement, size: number, display: number) {
  const key = `troop3d:${kind}`;
  if (game.textures.exists(key)) game.textures.remove(key);
  const tex = game.textures.addCanvas(key, canvas);
  if (!tex) return;
  const cols = Math.round(canvas.width / size);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < cols; c++) tex.add(`${r}:${c}`, 0, c * size, r * size, size, size);
  art.set(kind, { key, size, display });
}

async function blobToCanvas(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

let running: Promise<void> | null = null;

/** Make sure the army (and this General) is baked or loaded. Safe to call often. */
export function ensureArmyArt(game: Phaser.Game | null, general?: { appearance: Appearance; hash: string }) {
  if (!game) return Promise.resolve();
  if (running) return running;
  const wanted: { kind: TroopId; cacheKey: string; appearance?: Appearance }[] = [];
  const bake = import('../three/bake');
  running = (async () => {
    const { ART_VERSION, bakeTroopAtlas, releaseBaker, GAME_PX_PER_TILE } = await bake;
    const { TROOP_FRAME } = await import('../three/models/troops');
    for (const kind of ARMY) if (!art.has(kind)) wanted.push({ kind, cacheKey: `a${ART_VERSION}:${kind}` });
    if (general && generalFor !== general.hash) wanted.push({ kind: 'general', cacheKey: `a${ART_VERSION}:general:${general.hash}`, appearance: general.appearance });
    if (!wanted.length) return;
    progress.total = wanted.length * ROWS;
    progress.done = 0;
    progress.running = true;
    progress.failed = false;
    emit();
    try {
      for (const w of wanted) {
        const { size, scale } = TROOP_FRAME[w.kind];
        const display = GAME_PX_PER_TILE / scale;
        const cached = await artGet(w.cacheKey);
        let canvas: HTMLCanvasElement | null = cached ? await blobToCanvas(cached).catch(() => null) : null;
        if (!canvas) {
          const atlas = await bakeTroopAtlas(w.kind, w.appearance, () => {
            progress.done++;
            emit();
          });
          canvas = atlas.canvas;
          canvas.toBlob((b) => b && void artPut(w.cacheKey, b), 'image/png');
        } else {
          progress.done += ROWS;
          emit();
        }
        register(game, w.kind, canvas, size, display);
        if (w.kind === 'general') generalFor = general!.hash;
      }
    } catch (e) {
      console.warn('[art] 3D bake failed; battles keep the 2D drawings', e);
      progress.failed = true;
    } finally {
      releaseBaker();
      progress.running = false;
      progress.done = progress.total;
      emit();
      running = null;
    }
  })();
  return running;
}
