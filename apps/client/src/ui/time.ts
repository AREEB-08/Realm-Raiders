/** Ticks (20 per second) → m:ss. */
export const mmss = (tick: number) => {
  const s = Math.floor(tick / 20);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
