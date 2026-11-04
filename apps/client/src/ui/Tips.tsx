import { useState } from 'react';
import { Lightbulb } from 'lucide-react';

/**
 * Tutorial tips for the new features (spec Phase 8): one small card per screen, shown once,
 * remembered on this phone. "Got it" moves to the next tip; "No more tips" turns them all off.
 * Automated runs (navigator.webdriver) see none unless a test asks for them.
 */
export interface Tip {
  id: string;
  screen: string;
  text: string;
}

export const TIPS: Tip[] = [
  { id: 'zoom', screen: 'home', text: 'Pinch to zoom. In Build, hold a building for a moment, then drag it to move it.' },
  { id: 'auto', screen: 'home', text: 'New: Auto Mode. Set a few rules and your officers run the realm for you — 2 Gems per half-hour.' },
  { id: 'friends', screen: 'home', text: 'New: Play with Friends. On the same Wi-Fi you can raid each other and watch live, or duel for 3 minutes.' },
  { id: 'gems', screen: 'home', text: 'Gems are earned only by playing: log in, raid, earn badges, win duels. Tap the + next to them to see how.' },
  { id: 'walls', screen: 'build', text: 'Walls: tap Walls, then tap or drag on the map — each wall goes up at once.' },
  { id: 'plans', screen: 'warroom', text: 'The plans really differ: Stone Giants go for defences first, the Ember Mage throws three fireballs, the Fire Dragon flies over walls.' },
  { id: 'battle', screen: 'battle', text: 'Let the plan autoplay, or tap a troop card and then the map to deploy by hand. Rally when the General is up.' },
  { id: 'autolog', screen: 'report', text: 'The Auto Log lists every move your officers made — ✓ done, ✗ not allowed by your orders.' },
  { id: 'lobby', screen: 'lobby', text: 'Tap READY and send an emote. Save your base so friends can raid and duel you.' },
];

const KEY = 'realm-raiders-tips';
const FORCE = 'realm-raiders-tips-force';

function load(): { seen: string[]; off: boolean } {
  try {
    return { seen: [], off: false, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return { seen: [], off: false };
  }
}
function store(v: { seen: string[]; off: boolean }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private mode: tips just come back next time */
  }
}
const automated = () => {
  try {
    return navigator.webdriver && localStorage.getItem(FORCE) !== '1';
  } catch {
    return false;
  }
};

export function TipCard({ screen }: { screen: string }) {
  const [state, setState] = useState(load);
  if (state.off || automated()) return null;
  const tip = TIPS.find((t) => t.screen === screen && !state.seen.includes(t.id));
  if (!tip) return null;
  const save = (v: typeof state) => {
    store(v);
    setState(v);
  };
  return (
    <div className="tip-card fade-in" data-testid="tip" key={tip.id}>
      <Lightbulb size={18} color="#ffd54a" style={{ flex: 'none' }} />
      <span style={{ flex: 1 }} data-testid="tip-text">
        {tip.text}
      </span>
      <div className="col" style={{ gap: 4 }}>
        <button className="btn go small" onClick={() => save({ ...state, seen: [...state.seen, tip.id] })} data-testid="tip-ok">
          Got it
        </button>
        <button className="btn ghost small" onClick={() => save({ ...state, off: true })} data-testid="tip-off">
          No more tips
        </button>
      </div>
    </div>
  );
}
