import { useEffect, useState, type ReactNode } from 'react';
import { Coins, Flame, Gem, Trees, X } from 'lucide-react';
import { RANKS } from '@realm/game-data';
import type { EconomyDTO, GeneralDTO, HomeDTO, OfficerDTO } from '@realm/shared';
import { AssetImg } from './components';

/** Officer glyphs (code-drawn, no images). */
export const OFFICER_GLYPH: Record<string, string> = { general: '⚔', architect: '⚒', strategist: '⚑', night_captain: '☾', intel: '✦' };
/** Short names for the ticker ("Orrin: …"). */
export const OFFICER_SHORT: Record<string, string> = { architect: 'Orrin', strategist: 'Sefa', night_captain: 'Hale', intel: 'Whisper' };

/** Rank → level number (1-based) and progress to the next rank (0..1). */
export function levelOf(renown: number) {
  let i = 0;
  RANKS.forEach((r, k) => {
    if (renown >= r.min) i = k;
  });
  const cur = RANKS[i]!;
  const next = RANKS[i + 1];
  return { level: i + 1, name: cur.name, progress: next ? Math.max(0, Math.min(1, (renown - cur.min) / (next.min - cur.min))) : 1 };
}

/** Top-left: avatar, level number inside an XP ring, name, Renown under it. */
export function PlayerBadge({ general, renown, onClick }: { general: GeneralDTO | null; renown: number; onClick(): void }) {
  const l = levelOf(renown);
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <button className="hud-tl badge" onClick={onClick} data-testid="tab-profile" aria-label="Profile">
      <span className="ring">
        <svg viewBox="0 0 50 50" width="50" height="50">
          <circle cx="25" cy="25" r={r} fill="none" stroke="#11181d" strokeWidth="6" />
          <circle cx="25" cy="25" r={r} fill="none" stroke="#8fd0ff" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * l.progress} ${c}`} transform="rotate(-90 25 25)" />
        </svg>
        <span className="face">{general?.portraitUrl ? <AssetImg src={general.portraitUrl} /> : <span style={{ fontSize: 20 }}>⚔</span>}</span>
        <span className="lvl">{l.level}</span>
      </span>
      <span>
        <div className="name">{general?.name ?? 'Commander'}</div>
        <div className="renown">
          {l.name} · Renown {renown}
        </div>
      </span>
    </button>
  );
}

const RES = [
  { key: 'gold', label: 'Gold', color: 'var(--gold)', Icon: Coins },
  { key: 'timber', label: 'Timber', color: 'var(--timber)', Icon: Trees },
  { key: 'ember', label: 'Ember', color: 'var(--emberres)', Icon: Flame },
] as const;

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

/** Top-right: stacked Gold / Timber / Ember bars (fill + MAX) and Gems with a "+" (How to earn Gems). */
export function ResourceStack({ economy, onGems, compact = false }: { economy: EconomyDTO; onGems?: () => void; compact?: boolean }) {
  return (
    <div className="resstack" data-testid="resources">
      {RES.map(({ key, label, color, Icon }) => {
        const full = economy[key] >= economy.cap[key];
        return (
          <div className="resrow" key={key} aria-label={`${label} ${economy[key]} of ${economy.cap[key]}`} style={compact ? { minWidth: 120 } : undefined}>
            <div className="track">
              <i style={{ width: `${Math.min(100, (economy[key] / Math.max(1, economy.cap[key])) * 100)}%`, background: color }} />
              {full ? <span className="max">MAX</span> : null}
              <div className="amt">{fmt(economy[key])}</div>
            </div>
            <span className="ico" style={{ ['--c' as string]: color }}>
              <Icon size={15} color="#1a1208" strokeWidth={2.6} />
            </span>
          </div>
        );
      })}
      {!compact ? (
        <div className="resrow" aria-label={`Gems ${economy.gems}`} data-testid="gems">
          {onGems ? (
            <button className="plus" onClick={onGems} aria-label="How to earn Gems" data-testid="gems-plus">
              +
            </button>
          ) : null}
          <div className="track" style={{ paddingLeft: onGems ? 10 : 0 }}>
            <div className="amt">{fmt(economy.gems)}</div>
          </div>
          <span className="ico" style={{ ['--c' as string]: 'var(--gems)' }}>
            <Gem size={15} color="#1a1208" strokeWidth={2.6} />
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** "Shield 4h 12m" / "No shield", ticking. */
export function ShieldChip({ until, now }: { until: number; now: number }) {
  const [t, setT] = useState(now);
  useEffect(() => {
    setT(Date.now());
    const i = setInterval(() => setT(Date.now()), 30_000);
    return () => clearInterval(i);
  }, [until]);
  const left = Math.max(0, until - t);
  if (!left) return <span className="chip">🛡 No shield</span>;
  const h = Math.floor(left / 3_600_000);
  const m = Math.floor((left % 3_600_000) / 60_000);
  return <span className="chip info">🛡 Shield {h}h {m}m</span>;
}

/** Left edge: the five officers as a vertical column with red news dots. */
export function OfficerColumn({ officers, general, onOpen }: { officers: OfficerDTO[]; general: GeneralDTO | null; onOpen(role: string): void }) {
  return (
    <div className="officer-col">
      {officers.map((o) => (
        <button
          key={o.role}
          className="officer"
          title={o.title}
          aria-label={o.title}
          onClick={() => onOpen(o.role)}
          data-testid={o.role === 'night_captain' ? 'tab-night' : `officer-${o.role}`}
        >
          {o.role === 'general' && general?.portraitUrl ? <AssetImg src={general.portraitUrl} /> : OFFICER_GLYPH[o.role]}
          {o.news ? <span className="dot" /> : null}
        </button>
      ))}
    </div>
  );
}

export interface TickerLine {
  who: string;
  text: string;
  role: string;
}

/** Bottom-centre: one officer line at a time (tap opens the full briefing). */
export function Ticker({ lines, onOpen }: { lines: TickerLine[]; onOpen(): void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    setI(0);
    if (lines.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % lines.length), 6000);
    return () => clearInterval(t);
  }, [lines]);
  const line = lines[i % Math.max(1, lines.length)];
  return (
    <button className="ticker fade-in" key={`${i}:${line?.text}`} onClick={onOpen} data-testid="ticker">
      {line ? (
        <>
          <span className="who">{line.who}:</span>
          <span className="line">{line.text}</span>
        </>
      ) : (
        <span className="line muted">The officers are gathering…</span>
      )}
    </button>
  );
}

/** A centred wooden modal (max 70% wide) with a close button. */
export function Modal({ title, onClose, children, testId, wide }: { title: ReactNode; onClose(): void; children: ReactNode; testId?: string; wide?: boolean }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className={`panel brass modal fade-in${wide ? ' wide' : ''}`} onClick={(e) => e.stopPropagation()} data-testid={testId}>
        <div className="row" style={{ marginBottom: 8 }}>
          <div className="title" style={{ flex: 1, fontSize: 20 }}>
            {title}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** "+" next to Gems — exact copy from the spec; there is no shop and no price anywhere. */
export function GemsSheet({ onClose }: { onClose(): void }) {
  const rows: [string, string][] = [
    ['Log in daily', '+2'],
    ['First raid of the day', '+5'],
    ['3-star raid', '+3'],
    ['New badge', '+10'],
    ['Win a friend duel', '+5'],
  ];
  return (
    <Modal title="How to earn Gems" onClose={onClose} testId="gems-sheet">
      <div className="list2">
        {rows.map(([what, n]) => (
          <div key={what} className="card row" style={{ justifyContent: 'space-between', padding: '6px 10px' }}>
            <b>{what}</b>
            <span className="num" style={{ color: '#9b2fc0', fontSize: 18 }}>
              {n}
            </span>
          </div>
        ))}
      </div>
      <p style={{ margin: '10px 0 0', fontWeight: 800 }}>
        <Gem size={14} color="var(--gems)" /> Gems can't be bought. Spend them on Auto Mode — your officers run the realm while you're away.
      </p>
    </Modal>
  );
}

export function homeTickerLines(home: HomeDTO, mode: string, brief: { greeting: string; briefing?: string[] } | null): TickerLine[] {
  const g = home.general?.name ?? 'Your General';
  const lines: TickerLine[] = [];
  if (mode === 'local') lines.push({ who: g, role: 'general', text: 'Playing offline — the whole realm runs on your phone.' });
  if (brief?.greeting) lines.push({ who: g, role: 'general', text: brief.greeting });
  for (const b of brief?.briefing ?? []) lines.push({ who: g, role: 'general', text: b });
  if (!home.base.sealedHash || home.base.dirty)
    lines.push({ who: OFFICER_SHORT.architect!, role: 'architect', text: "Your base isn't saved yet — tap Build, then Save." });
  if (!home.activePolicy) lines.push({ who: OFFICER_SHORT.night_captain!, role: 'night_captain', text: 'Night orders are ready for your seal.' });
  if (home.pendingReport) lines.push({ who: OFFICER_SHORT.intel!, role: 'intel', text: 'The Morning Report is waiting. Tap to read it.' });
  lines.push({ who: OFFICER_SHORT.strategist!, role: 'strategist', text: 'Three rival holdfasts are ready. Pick one and I will plan the attack.' });
  return lines;
}
