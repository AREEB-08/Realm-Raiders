import { useEffect, useState } from 'react';
import { defaultAppearance, type Appearance } from '@realm/shared';

/** The rival lords of the NPC islands, as code-built 3D Generals (spec F6). */
const LORDS: Record<string, Appearance> = {
  briarholt: { ...defaultAppearance('thornmarch'), body: 'knight', head: 'bearded', hair: 'short', cloak: 'short_cape', weapon: 'axe', shield: 'round' },
  kragmoor: { ...defaultAppearance('hollowdeep'), body: 'warden', head: 'braided', hair: 'horned_helm', cloak: 'long_cloak', weapon: 'hammer', shield: 'heater' },
  saltspire: { ...defaultAppearance('skyrend'), body: 'runecaller', head: 'plain', hair: 'circlet', cloak: 'banner_pole', weapon: 'spear', shield: 'kite' },
};

const cache = new Map<string, Promise<string | null>>();

function portraitOf(key: string): Promise<string | null> {
  let p = cache.get(key);
  if (!p) {
    const a = LORDS[key];
    p = a ? import('../three/bake').then((m) => m.bakePortrait(a)).catch(() => null) : Promise.resolve(null);
    cache.set(key, p);
  }
  return p;
}

/** A rival lord's 3D portrait (baked once per session); a crest while it renders or without WebGL. */
export function LordPortrait({ islandId, size = 56 }: { islandId: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void portraitOf(islandId).then((u) => live && setSrc(u));
    return () => {
      live = false;
    };
  }, [islandId]);
  return (
    <span className="lord" style={{ width: size, height: size }} data-testid={`lord-${islandId}`}>
      {src ? <img src={src} alt="" /> : <span style={{ fontSize: size * 0.45 }}>⚔</span>}
    </span>
  );
}
