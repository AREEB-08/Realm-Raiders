import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Coins, Swords, Trees } from 'lucide-react';
import type { TargetDTO } from '@realm/shared';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { Spinner } from '../../ui/components';
import { LordPortrait } from '../../ui/LordPortrait';
import { ResourceStack } from '../../ui/hud';

const DIFF = { easy: { cls: 'good', label: 'Easy' }, medium: { cls: 'brass', label: 'Medium' }, hard: { cls: 'bad', label: 'Hard' } } as const;

/**
 * 05 — Find a target: the enemy base fills the screen (pan and zoom it to scout), one target at a
 * time with arrows, then ATTACK. The General's pick comes first.
 */
export function Targets() {
  const { back, go, fail, home, route } = useStore();
  const wantFriend = !!route.params?.friend;
  const [islands, setIslands] = useState<TargetDTO[] | null>(null);
  const [i, setI] = useState(0);
  useEffect(() => {
    api
      .get<{ islands: TargetDTO[] }>('/targets')
      .then((r) => {
        setIslands(r.islands);
        // From the lobby's RAID FRIEND: open on your friend; otherwise on the General's pick.
        const friend = wantFriend ? r.islands.findIndex((x) => x.friend) : -1;
        const pick = r.islands.findIndex((x) => x.recommended);
        setI(friend >= 0 ? friend : pick >= 0 ? pick : 0);
      })
      .catch(fail);
  }, [fail, wantFriend]);
  const t = islands?.[i] ?? null;
  useEffect(() => {
    if (t) gameCtl.showIsland({ layout: t.layout, mode: 'preview', faction: 'npc', look: 'day' });
  }, [t]);

  if (!islands || !home) return <div className="screen center"><Spinner label="Scouting the forest roads…" /></div>;
  if (!t) return <div className="screen center">No rivals found.</div>;
  const step = (d: number) => setI((x) => (x + d + islands.length) % islands.length);
  const diff = DIFF[t.difficulty];
  return (
    <div className="overlay targets-screen">
      <div className="row pass" style={{ alignItems: 'flex-start', gap: 8 }}>
        <button className="icon-btn" onClick={back} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="target-head panel">
          <LordPortrait islandId={t.islandId} size={46} />
          <div style={{ minWidth: 0 }}>
            <div className="title" style={{ fontSize: 19, lineHeight: 1.05 }} data-testid="target-name">
              {t.name}
            </div>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
              {t.ownerName}
            </div>
          </div>
          <span className={`chip ${diff.cls}`}>{diff.label}</span>
        </div>
        <div className="spacer" />
        <ResourceStack economy={home.economy} compact />
      </div>

      <div className="spacer" />

      <div className="row pass" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div className="target-info panel">
          <div className="loot">
            <span>
              <Coins size={15} /> {t.lootEst.gold.toLocaleString('en-US')}
            </span>
            <span>
              <Trees size={15} /> {t.lootEst.timber.toLocaleString('en-US')}
            </span>
          </div>
          <div style={{ fontSize: 12, fontWeight: 800 }}>
            Citadel level {t.citadelLvl}
            {t.recommended ? <span className="chip brass" style={{ marginLeft: 6 }}>General's pick</span> : null}
            {t.friend ? <span className="chip info" style={{ marginLeft: 6 }}>Friend</span> : null}
          </div>
          {!t.sealed ? <div className="bad-text" style={{ fontSize: 12, fontWeight: 800 }}>{t.intel.includes('shield') ? t.intel : "Can't be attacked right now."}</div> : null}
        </div>
        <div className="spacer" />
        <div className="target-pager">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous target" data-testid="target-prev">
            <ChevronLeft size={22} />
          </button>
          <div className="dots">
            {islands.map((x, k) => (
              <button key={x.islandId} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={x.name} data-testid={`target-${x.islandId}`} />
            ))}
          </div>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next target" data-testid="target-next">
            <ChevronRight size={22} />
          </button>
        </div>
        <div className="spacer" />
        <button className="round-btn raid" disabled={!t.sealed} onClick={() => go('warroom', { islandId: t.islandId })} data-testid={`raid-${t.islandId}`} aria-label={`Attack ${t.name}`}>
          <Swords size={34} strokeWidth={2.6} />
          <span className="lbl">ATTACK</span>
        </button>
      </div>
    </div>
  );
}
