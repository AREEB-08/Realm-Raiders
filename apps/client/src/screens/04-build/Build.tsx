import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, Check, ChevronLeft, FastForward, Fence, Lightbulb, Lock, Store, Wand2, X } from 'lucide-react';
import { BUILDINGS, BUILDING_IDS, buildCost, buildSeconds, limitFor, maxLevelFor, type BuildingId, type Layout } from '@realm/game-data';
import { canPlace, occupancy, planWalls, resourceName } from '@realm/core';
import type { ArchitectReview, BaseDTO, EconomyDTO, LayoutMove } from '@realm/shared';
import { useWallet } from '../../auth/bridge';
import { sealBase } from '../../chain/tx';
import { bus } from '../../game/bus';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { OfficerBubble } from '../../ui/components';
import { ResourceStack } from '../../ui/hud';
import { TroopCards } from '../../ui/TroopCards';
import { buildingThumb } from '../../ui/buildingThumb';
import { sfx } from '../../audio/sfx';

type SaveOut = { base: BaseDTO; economy: EconomyDTO };

/** Shop tabs and which building categories each one lists. */
const SHOP_TABS = ['Defences', 'Resources', 'Army', 'Walls & Traps'] as const;
type ShopTab = (typeof SHOP_TABS)[number];
const TAB_CATEGORIES: Record<ShopTab, string[]> = {
  Defences: ['defence'],
  Resources: ['resource', 'storage'],
  Army: ['army'],
  'Walls & Traps': ['wall', 'trap'],
};

/** A free spot for a new building, searched outwards from the Citadel. */
function freeSpot(layout: Layout, type: BuildingId) {
  const occ = occupancy(layout);
  const c = layout.buildings.find((b) => b.type === 'citadel');
  const cx = (c?.x ?? 13) + 1;
  const cy = (c?.y ?? 13) + 1;
  for (let r = 3; r < 15; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (canPlace(occ, type, cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
  return { x: cx, y: cy };
}

/** 04 — Build: move, place (ghost + ✓), upgrade, wall brush, Builder tips, then save the base. */
export function Build() {
  const { home, refreshHome, back, fail, toast, route } = useStore();
  const wallet = useWallet();
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<BuildingId | null>(null);
  const [placeAt, setPlaceAt] = useState<{ x: number; y: number } | null>(null);
  const [wallTool, setWallTool] = useState(false);
  const [shop, setShop] = useState(!!route.params?.shop);
  const [shopTab, setShopTab] = useState<ShopTab>('Defences');
  const [tipsOpen, setTipsOpen] = useState(!!route.params?.patch);
  const [review, setReview] = useState<ArchitectReview | null>(null);
  const [ghost, setGhost] = useState<LayoutMove[] | null>((route.params?.patch as LayoutMove[] | undefined) ?? null);
  const [busy, setBusy] = useState<'save' | 'place' | null>(null);
  const [layout, setLayout] = useState<Layout | null>(home?.base.layout ?? null);
  const live = useRef({ layout, purse: home?.economy ?? null });
  live.current = { layout, purse: home?.economy ?? null };

  useEffect(() => {
    if (home) setLayout(home.base.layout);
  }, [home]);

  const purse = home?.economy;
  const planLine = useCallback((tiles: { x: number; y: number }[]) => (layout && purse ? planWalls(layout, purse, tiles).tiles : []), [layout, purse]);

  useEffect(() => {
    if (!home || !layout) return;
    gameCtl.showIsland({
      layout,
      mode: 'edit',
      faction: home.general?.faction,
      timers: home.base.timers,
      selectedId: selected,
      placing,
      placeAt,
      wallTool,
      planWalls: planLine,
      ghostMoves: ghost,
      look: 'day',
    });
  }, [home, layout, selected, placing, placeAt, wallTool, planLine, ghost]);

  const loadTips = useCallback(async (l?: Layout) => {
    try {
      const r = await api.post<{ output: ArchitectReview; fallback: boolean }>('/agents/architect/tips', l ? { layout: l } : {});
      setReview(r.output);
    } catch {
      /* tips are optional */
    }
  }, []);
  useEffect(() => {
    void loadTips();
  }, [loadTips]);

  useEffect(() => {
    let tipTimer: ReturnType<typeof setTimeout> | null = null;
    const offs = [
      bus.on('building-select', ({ id }) => {
        setSelected(id);
        setShop(false);
      }),
      bus.on('layout-change', async ({ layout: l }) => {
        setLayout(l);
        try {
          const r = await api.put<{ ok: boolean; errors: string[] }>('/base/layout', { layout: l });
          if (!r.ok) toast(r.errors[0] ?? "That spot isn't allowed.", 'bad');
          else sfx.play('build');
        } catch (e) {
          fail(e);
        }
        await refreshHome();
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(() => void loadTips(), 3000);
      }),
      bus.on('layout-invalid', ({ reason }) => toast(reason, 'bad')),
      bus.on('place-move', (at) => setPlaceAt(at)),
      // Wall brush: walls go up at once on every free tile the finger touched (taken ones are skipped).
      bus.on('wall-line', async ({ tiles }) => {
        const { layout: l, purse: p } = live.current;
        if (!l || !p) return;
        const plan = planWalls(l, p, tiles);
        if (!plan.placeable.length) return toast(plan.problem ?? "Walls can't go there.", 'bad');
        try {
          await api.post('/base/walls', { tiles: plan.placeable });
          sfx.play('build');
          await refreshHome();
        } catch (e) {
          fail(e);
        }
      }),
    ];
    return () => {
      offs.forEach((o) => o());
      if (tipTimer) clearTimeout(tipTimer);
    };
  }, [refreshHome, fail, toast, loadTips]);

  const sel = useMemo(() => layout?.buildings.find((b) => b.id === selected) ?? null, [layout, selected]);
  if (!home || !layout) return null;
  const cl = home.base.citadelLevel;
  const timer = sel ? home.base.timers.find((t) => t.buildingId === sel.id) : undefined;
  const walls = layout.buildings.filter((b) => b.type === 'wall').length;
  const wallLimit = limitFor('wall', cl);

  const upgrade = async () => {
    if (!sel) return;
    try {
      await api.post('/base/upgrade', { buildingId: sel.id });
      sfx.play('build');
      await refreshHome();
    } catch (e) {
      fail(e);
    }
  };
  const hurry = async () => {
    if (!sel) return;
    try {
      await api.post('/base/hurry', { buildingId: sel.id });
      sfx.play('star');
      await refreshHome();
    } catch (e) {
      fail(e);
    }
  };
  const applyFix = async () => {
    try {
      await api.post('/base/patch/apply', {});
      setGhost(null);
      sfx.play('build');
      toast('Done — your buildings moved. Save the base to keep it.', 'good');
      await refreshHome();
      void loadTips();
    } catch (e) {
      fail(e);
    }
  };
  const startPlacing = (t: BuildingId) => {
    setShop(false);
    setSelected(null);
    setWallTool(false);
    if (t === 'wall') return setWallTool(true);
    setPlacing(t);
    setPlaceAt(freeSpot(layout, t));
  };
  const cancelPlacing = () => {
    setPlacing(null);
    setPlaceAt(null);
  };
  const confirmPlace = async () => {
    if (!placing || !placeAt) return;
    setBusy('place');
    try {
      await api.post<SaveOut>('/base/build', { type: placing, x: placeAt.x, y: placeAt.y });
      sfx.play('build');
      toast(`${BUILDINGS[placing].name} is being built.`, 'good');
      cancelPlacing();
      await refreshHome();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    try {
      const prep = await api.post<{ baseHash: `0x${string}`; version: number }>('/base/seal/prepare');
      // The phone recomputes the base fingerprint too; it must equal the server's.
      if (prep.baseHash !== home.base.currentHash) throw new Error('This phone and the server disagree about your base — try again.');
      await sealBase(wallet, home.chainMode, prep.baseHash, prep.version);
      sfx.play('seal');
      toast('Base saved ✓', 'good');
      await refreshHome();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const saved = !!home.base.sealedHash && !home.base.dirty;
  const placeOk = placing && placeAt ? canPlace(occupancy(layout), placing, placeAt.x, placeAt.y) : false;
  const shopItems = BUILDING_IDS.filter((t) => t !== 'citadel' && TAB_CATEGORIES[shopTab].includes(BUILDINGS[t].category));
  const free = home.economy.builders.total - home.economy.builders.busy;

  return (
    <div className="overlay build-screen" style={{ gap: 6 }}>
      <div className="row pass" style={{ alignItems: 'flex-start', gap: 8 }}>
        <button className="icon-btn" onClick={back} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
        <div className="col" style={{ gap: 4, alignItems: 'flex-start' }}>
          <div className="title" style={{ fontSize: 20, lineHeight: 1 }}>
            Build
          </div>
          <span className="chip" data-testid="builders">
            Builders {free}/{home.economy.builders.total}
          </span>
        </div>
        <div className="spacer" />
        <span className={`chip ${saved ? 'good' : 'bad'}`} data-testid="seal-status">
          {saved ? (
            <>
              <Lock size={12} /> Saved ✓
            </>
          ) : (
            'Not saved'
          )}
        </span>
        <div className="spacer" />
        <ResourceStack economy={home.economy} compact />
      </div>

      {review && !placing && !wallTool ? (
        tipsOpen ? (
          <div style={{ maxWidth: 'min(46vw, 400px)' }} className="fade-in">
            <OfficerBubble role="architect" name="Builder Orrin">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {review.tips.slice(0, 2).map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
              <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: 'wrap' }}>
                {review.patch ? (
                  ghost ? (
                    <button className="btn small" onClick={applyFix} data-testid="apply-fix">
                      <Wand2 size={14} /> Move them
                    </button>
                  ) : (
                    <button className="btn info small" onClick={() => setGhost(review.patch!.moves)}>
                      Show my idea
                    </button>
                  )
                ) : null}
                <button className="btn ghost small" onClick={() => (setTipsOpen(false), setGhost(null))}>
                  Close
                </button>
              </div>
            </OfficerBubble>
          </div>
        ) : (
          <div className="pass">
            <button className="chip brass tappable" onClick={() => setTipsOpen(true)} data-testid="orrin-tips">
              <Lightbulb size={13} /> Builder tips
            </button>
          </div>
        )
      ) : null}
      <div className="spacer" />

      {/* Bottom bar: the current tool on the left, actions on the right. */}
      <div className="row pass" style={{ alignItems: 'flex-end', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0, maxWidth: 520 }}>
          {placing && placeAt ? (
            <div className="panel brass fade-in row" data-testid="place-bar" style={{ padding: '8px 10px', gap: 8 }}>
              <img className="thumb sm" src={buildingThumb(placing, home.general?.faction)} alt="" />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}>
                {placeOk ? `Tap the map to move the ${BUILDINGS[placing].name}.` : 'Something is in the way — tap a free spot.'}
              </span>
              <button className="btn danger small" onClick={cancelPlacing} data-testid="place-cancel" aria-label="Cancel">
                <X size={16} />
              </button>
              <button className="btn good small" disabled={!placeOk || busy === 'place'} onClick={confirmPlace} data-testid="place-confirm">
                <Check size={16} /> {buildCost(placing, 1).amount} {resourceName(buildCost(placing, 1).resource)}
              </button>
            </div>
          ) : wallTool ? (
            <div className="panel brass fade-in row" data-testid="wall-bar" style={{ padding: '8px 10px', gap: 8 }}>
              <Fence size={20} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700 }}>
                Tap or drag on the map to build walls.
                <span className="muted" style={{ display: 'block', fontSize: 12 }}>
                  {walls}/{wallLimit} walls · {buildCost('wall', 1).amount} {resourceName(buildCost('wall', 1).resource)} each
                </span>
              </span>
              <button className="btn good small" onClick={() => setWallTool(false)} data-testid="wall-done">
                <Check size={16} /> Done
              </button>
            </div>
          ) : null}
        </div>
        <button className={`round-btn ${wallTool ? 'info' : 'wood'} mid`} onClick={() => (cancelPlacing(), setSelected(null), setWallTool(!wallTool))} data-testid="wall-tool" aria-label="Walls">
          <Fence size={22} />
          <span className="lbl">Walls</span>
        </button>
        <button className="round-btn go mid" onClick={() => (setShop((x) => !x), setSelected(null), cancelPlacing(), setWallTool(false))} data-testid="shop" aria-label="Shop">
          <Store size={24} />
          <span className="lbl">Shop</span>
        </button>
        <button className="btn ember big" disabled={busy === 'save' || saved} onClick={save} data-testid="seal">
          <Lock size={18} /> {busy === 'save' ? 'Saving…' : saved ? 'Saved' : 'SAVE BASE'}
        </button>
      </div>

      {sel && !shop && !placing ? (
        <div className="panel brass drawer fade-in" style={{ bottom: 'auto', maxHeight: 'calc(100% - 16px)' }} data-testid="building-panel">
          <div className="row" style={{ gap: 8 }}>
            <img className="thumb" src={buildingThumb(sel.type, home.general?.faction, sel.level)} alt="" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b className="title" style={{ fontSize: 19 }}>
                {BUILDINGS[sel.type].name}
              </b>
              <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
                Level {sel.level}
              </div>
            </div>
            <button className="icon-btn" onClick={() => setSelected(null)} aria-label="Close">
              <X size={18} />
            </button>
          </div>
          <div style={{ fontSize: 13, margin: '6px 0 8px', fontWeight: 700 }}>{BUILDINGS[sel.type].blurb}</div>
          {timer ? (
            <button className="btn info block" onClick={hurry}>
              <FastForward size={16} /> Finish now — {Math.max(0, Math.ceil((timer.readyAt - Date.now()) / 1000))}s left
            </button>
          ) : sel.level < maxLevelFor(sel.type, cl) ? (
            <button className="btn block" onClick={upgrade} data-testid="upgrade">
              <ArrowUpCircle size={16} /> Upgrade · {buildCost(sel.type, sel.level + 1).amount} {resourceName(buildCost(sel.type, sel.level + 1).resource)} · {buildSeconds(sel.level + 1)}s
            </button>
          ) : (
            <div className="muted">{sel.level >= BUILDINGS[sel.type].maxLevel ? 'Fully upgraded.' : `Upgrade your Citadel first.`}</div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Tip: hold a building, then drag it to move it.
          </div>
        </div>
      ) : null}

      {shop ? (
        <div className="modal-back shop-back" onClick={() => setShop(false)}>
          <div className="panel brass shop-sheet fade-in" onClick={(e) => e.stopPropagation()} data-testid="shop-drawer">
            <div className="row" style={{ marginBottom: 8, gap: 8 }}>
              <b className="title" style={{ fontSize: 22 }}>
                Shop
              </b>
              <div className="tabs" style={{ flex: 1 }}>
                {SHOP_TABS.map((t) => (
                  <button key={t} className={t === shopTab ? 'on' : ''} onClick={() => setShopTab(t)} data-testid={`shop-tab-${t}`}>
                    {t}
                  </button>
                ))}
              </div>
              <button className="icon-btn" onClick={() => setShop(false)} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            {shopTab === 'Army' ? (
              <TroopCards level={home.economy.troopLevel} />
            ) : (
              <div className="shop-grid">
                {shopItems.map((t) => {
                  const have = layout.buildings.filter((b) => b.type === t).length;
                  const lim = limitFor(t, cl);
                  const cost = buildCost(t, 1);
                  const locked = lim === 0;
                  const full = !locked && have >= lim;
                  const poor = home.economy[cost.resource] < cost.amount;
                  return (
                    <button
                      key={t}
                      className={`shop-card${locked || full ? ' off' : ''}`}
                      disabled={locked || full}
                      data-testid={`shop-${t}`}
                      onClick={() => startPlacing(t)}
                    >
                      <img className="thumb" src={buildingThumb(t, home.general?.faction)} alt="" />
                      <b>{BUILDINGS[t].name}</b>
                      <span className={`price ${cost.resource}${poor ? ' poor' : ''}`}>
                        {cost.amount.toLocaleString('en-US')} {resourceName(cost.resource)}
                      </span>
                      <span className="count">{locked ? `Citadel ${BUILDINGS[t].unlockCitadel}` : full ? 'All built' : `Built ${have}/${lim}`}</span>
                      {locked ? (
                        <span className="lock">
                          <Lock size={16} />
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
