// Reused from web-coc (src/game/runtime-budget.ts) under the owner's code licence — see LICENSES/README.md.
/** Retained, evictable rendering resources; live scene textures keep their own ownership. */
interface RuntimeBudget {
  readonly maxDensity: number;
  readonly playFps: number;
  readonly decodedImageBytes: number;
  readonly freeGroupBytes: number;
  readonly tintedTextureBytes: number;
  readonly sourcePixelBytes: number;
}

const desktop: RuntimeBudget = {
  maxDensity: Infinity,
  playFps: 0,
  decodedImageBytes: 64 << 20,
  freeGroupBytes: 48 << 20,
  tintedTextureBytes: 32 << 20,
  sourcePixelBytes: 32 << 20,
};
const mobile: RuntimeBudget = {
  maxDensity: 2,
  playFps: 60,
  decodedImageBytes: 16 << 20,
  freeGroupBytes: 12 << 20,
  tintedTextureBytes: 8 << 20,
  sourcePixelBytes: 8 << 20,
};

/** Primary coarse input covers phones and tablets without browser-name or viewport heuristics. */
export const runtimeBudget =
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? mobile : desktop;
