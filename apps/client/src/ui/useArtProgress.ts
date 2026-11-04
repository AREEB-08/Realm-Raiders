import { useEffect, useState } from 'react';
import { onArtProgress } from '../game/baked';

/** Percent of the 3D army bake while it runs ("Forging your army… 63%"), else null. */
export function useArtProgress(): number | null {
  const [pct, setPct] = useState<number | null>(null);
  useEffect(
    () =>
      onArtProgress((p) => {
        setPct(p.running && p.total > 0 ? Math.min(99, Math.round((p.done / p.total) * 100)) : null);
      }),
    [],
  );
  return pct;
}
