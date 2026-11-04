/** Orthogonal wall line from a to b (the drag's dominant axis). */
export function wallLine(a: { x: number; y: number }, b: { x: number; y: number }) {
  const tiles: { x: number; y: number }[] = [];
  const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
  const n = horizontal ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y);
  const sx = Math.sign(b.x - a.x);
  const sy = Math.sign(b.y - a.y);
  for (let i = 0; i <= Math.min(n, 30); i++) tiles.push(horizontal ? { x: a.x + i * sx, y: a.y } : { x: a.x, y: a.y + i * sy });
  return tiles;
}
