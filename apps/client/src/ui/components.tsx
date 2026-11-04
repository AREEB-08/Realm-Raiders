import { useEffect, useState, type ReactNode } from 'react';
import { ChevronLeft, ExternalLink, Link2, Shield, Star } from 'lucide-react';
import type { TxRef } from '@realm/shared';
import { useStore } from '../state';

export function Stars({ n, big = false, animate = false }: { n: number; big?: boolean; animate?: boolean }) {
  return (
    <span className={`stars${big ? ' big' : ''}`} aria-label={`${n} of 3 stars`}>
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          className={`star${i < n ? ' on' : ''}${animate && i < n ? ' pop' : ''}`}
          fill={i < n ? 'currentColor' : 'none'}
          style={animate ? { animationDelay: `${0.25 + i * 0.35}s` } : undefined}
        />
      ))}
    </span>
  );
}

export function Meter({ value, max = 100, kind = '' }: { value: number; max?: number; kind?: '' | 'hp' | 'teal' }) {
  return (
    <div className={`meter ${kind}`}>
      <i style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%` }} />
    </div>
  );
}

/** Proof chip: "Monad ✓" (opens the explorer) or "Saved ✓" offline. The full hash is in the tooltip. */
export function ChainChip({ tx, label, pending }: { tx?: TxRef | null; label: string; pending?: boolean }) {
  const url = tx?.url ?? null;
  const open = () => {
    if (url) window.open(url, '_blank', 'noopener');
  };
  if (pending)
    return (
      <span className="chip brass">
        <Link2 size={13} className="spin" /> {label}…
      </span>
    );
  if (!tx) return null;
  return (
    <span className={`chip good${url ? ' tappable' : ''}`} onClick={open} title={`${label} · ${tx.hash}`} data-label={label}>
      <Link2 size={13} /> {tx.mode === 'mock' ? 'Saved ✓' : 'Monad ✓'}
      {tx.mode === 'mock' ? null : <ExternalLink size={12} />}
    </span>
  );
}

const OFFICER_ICONS: Record<string, string> = {
  general: '⚔',
  architect: '⚒',
  strategist: '⚑',
  night_captain: '☾',
  intel: '✦',
};

const blobCache = new Map<string, Promise<string>>();

/**
 * Chrome's WebView auto-upgrades plain-http <img> loads on an https page (the Capacitor origin)
 * to https, which a dev server on http://10.0.2.2 or a LAN IP does not serve. Loading the bytes
 * with fetch (allowed in debug builds) into a blob: URL sidesteps the upgrade.
 */
export function useAssetSrc(src: string | null | undefined): string | null {
  const needsFetch = !!src && src.startsWith('http:') && location.protocol === 'https:';
  const [out, setOut] = useState<string | null>(needsFetch ? null : (src ?? null));
  useEffect(() => {
    if (!src || !needsFetch) {
      setOut(src ?? null);
      return;
    }
    let alive = true;
    let p = blobCache.get(src);
    if (!p) {
      p = fetch(src)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
        .then((b) => URL.createObjectURL(b));
      blobCache.set(src, p);
    }
    p.then((u) => alive && setOut(u)).catch(() => alive && setOut(null));
    return () => {
      alive = false;
    };
  }, [src, needsFetch]);
  return out;
}

export function AssetImg({ src, alt = '' }: { src: string | null | undefined; alt?: string }) {
  const url = useAssetSrc(src);
  return url ? <img src={url} alt={alt} /> : null;
}

export function OfficerAvatar({ role, portrait }: { role: string; portrait?: string | null }) {
  return (
    <div className="avatar">
      {portrait && role === 'general' ? <AssetImg src={portrait} /> : <span style={{ fontSize: 20, color: 'var(--brass-hi)' }}>{OFFICER_ICONS[role] ?? '✦'}</span>}
    </div>
  );
}

/** `<OfficerBubble role=…>` (§11 conventions): typing shimmer, text, "(field manual)" tag. */
export function OfficerBubble({
  role,
  name,
  loading,
  fallback,
  children,
  portrait,
}: {
  role: string;
  name: string;
  loading?: boolean;
  fallback?: boolean;
  children?: ReactNode;
  portrait?: string | null;
}) {
  return (
    <div className="bubble fade-in">
      <OfficerAvatar role={role} portrait={portrait} />
      <div className="speech">
        <div className="who">
          {name}
          {/* Whether the AI model or the built-in rules answered is not the player's concern. */}
          {fallback === undefined || loading ? null : null}
        </div>
        {loading ? (
          <>
            <div className="shimmer" style={{ width: '90%' }} />
            <div className="shimmer" style={{ width: '60%' }} />
          </>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
      {onBack ? (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <ChevronLeft size={22} />
        </button>
      ) : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="title">{title}</div>
        {subtitle ? <div className="subtitle">{subtitle}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="center col" style={{ padding: 30, gap: 10 }}>
      <Shield className="spin" color="var(--brass)" />
      {label ? <div className="flavour muted">{label}</div> : null}
    </div>
  );
}

export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const tick = () => {
      const f = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - f, 3))));
      if (f < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Mmss({ seconds }: { seconds: number }) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return (
    <span className="num">
      {m}:{String(s).padStart(2, '0')}
    </span>
  );
}
