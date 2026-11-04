// Reused from web-coc (src/game/unit-depth.ts) under the owner's code licence — see LICENSES/README.md.
/**
 * Display-list depth for battle units.
 *
 * Native units render as many parts at `unitDepth + order * PART_DEPTH_STEP`, and Phaser's
 * stable sort breaks depth ties in creation order. Two units at the same depth therefore
 * interleave part by part. Every unit gets a unique depth instead: ground units follow screen y
 * (as before), and flyers are y-sorted inside the air band [7500, 7590), which stays below
 * defender bars (7600) and effects (8000). An id tie-break separates units standing at the
 * same screen y. Parts of one unit stay well inside the gap between two tie-break slots.
 */
export const AIR_DEPTH = 7500;
/** Depth step between the ordered parts of one native unit (up to 1000 parts per unit). */
export const PART_DEPTH_STEP = 1e-6;
const TIE_SLOTS = 40;
const TIE_STEP = 1e-3;

/** Unique id-derived offset in [0, 0.04). */
export function unitDepthTie(id: number) {
  return ((((id | 0) % TIE_SLOTS) + TIE_SLOTS) % TIE_SLOTS) * TIE_STEP;
}

/**
 * `screenY` is the unit's ground point in world pixels (iso y, roughly 112..1650).
 * `offset` keeps the existing per-kind nudges (hero 1.2, defender 1.1, troop 1).
 */
export function unitDepth(screenY: number, id: number, flying: boolean, offset = 1) {
  return flying ? AIR_DEPTH + screenY / 20 + unitDepthTie(id) : screenY + offset + unitDepthTie(id);
}
