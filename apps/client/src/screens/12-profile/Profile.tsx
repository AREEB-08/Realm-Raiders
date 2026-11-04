import { useEffect, useRef, useState } from 'react';
import { Gem, LogOut, Share2, ShieldCheck } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { base64ToBytes } from '@realm/battle-engine';
import { FACTIONS, PERSONALITIES } from '@realm/game-data';
import { explorerAddress, shortHash, type AgentResponse, type BattleDTO, type GemsDTO, type GeneralOutput, type ProfileDTO } from '@realm/shared';
import { api } from '../../net/api';
import { config } from '../../net/config';
import { workerSims } from '../../net/local';
import { useStore } from '../../state';
import { CharacterStage } from '../../three/CharacterStage';
import { ChainChip, Header, OfficerBubble, Spinner, Stars } from '../../ui/components';
import { RealmNative } from '../../ui/lib/realmNative';

type Check = 'running' | 'ok' | 'bad';

/** Draw the shareable General card (1080×1350 PNG) and return it as base64 (no data: prefix). */
async function drawCard(p: ProfileDTO): Promise<string> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 1350);
  g.addColorStop(0, '#1d3d4a');
  g.addColorStop(1, '#0b171d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.strokeStyle = '#c9a24a';
  ctx.lineWidth = 10;
  ctx.strokeRect(30, 30, 1020, 1290);
  if (p.general?.portraitUrl) {
    try {
      const raw = p.general.portraitUrl;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = raw.startsWith('http:') && location.protocol === 'https:' ? URL.createObjectURL(await (await fetch(raw)).blob()) : raw;
      await new Promise((r) => {
        img.onload = r;
        img.onerror = r;
      });
      ctx.drawImage(img, 240, 90, 600, 600);
    } catch {
      /* no portrait (offline, tainted canvas): the card still works */
    }
  }
  ctx.fillStyle = '#ecc96b';
  ctx.textAlign = 'center';
  ctx.font = '700 72px Cinzel, serif';
  ctx.fillText(p.general?.name ?? 'Raider', 540, 790);
  ctx.fillStyle = '#ece7dc';
  ctx.font = '40px Almendra, serif';
  ctx.fillText(`${p.rank.name} · ${p.renown} Renown`, 540, 860);
  ctx.fillText(`Raids ${p.record.raidsWon}–${p.record.raidsLost} · Defences ${p.record.defencesWon}–${p.record.defencesLost}`, 540, 920);
  ctx.fillText(`Badges: ${p.badges.filter((b) => b.earned).map((b) => b.name).join(', ') || '—'}`, 540, 990);
  ctx.font = '30px monospace';
  ctx.fillStyle = '#9aa8af';
  ctx.fillText(`Agent #${p.general?.agentId ?? '—'} · ${shortHash(p.player.address, 8, 6)}`, 540, 1080);
  ctx.font = '700 44px Cinzel, serif';
  ctx.fillStyle = '#e8743b';
  ctx.fillText('REALM RAIDERS', 540, 1240);
  return c.toDataURL('image/png').split(',')[1]!;
}

/** 12 — General Profile: identity, reputation and badges read from the chain; verifiable battles. */
export function Profile() {
  const { back, home, fail, toast, signOut, mode } = useStore();
  const playerId = home?.player.id ?? null;
  const host = useRef<HTMLDivElement>(null);
  const [p, setP] = useState<ProfileDTO | null>(null);
  const [line, setLine] = useState<{ text: string; fallback: boolean } | null>(null);
  const [checked, setChecked] = useState<Record<string, Check>>({});
  const [sharing, setSharing] = useState(false);
  const [tab, setTab] = useState<'General' | 'Badges' | 'Battles' | 'Gems'>('General');
  const [gems, setGems] = useState<GemsDTO | null>(null);
  useEffect(() => {
    if (tab !== 'Gems') return;
    api
      .get<GemsDTO>('/gems')
      .then(setGems)
      .catch(() => setGems(null));
  }, [tab]);

  // One fetch per visit. (It used to re-fetch on every Home refresh, rebuilding the 3D stage.)
  useEffect(() => {
    if (!playerId) return;
    let live = true;
    api
      .get<ProfileDTO>(`/profile/${playerId}`)
      .then((x) => {
        if (!live) return;
        if (x.general) x.general.portraitUrl = api.asset(x.general.portraitUrl);
        setP(x);
        setLine({ text: x.line, fallback: x.agent.fallback });
        // The General's AI line arrives after the page is already on screen.
        api
          .post<AgentResponse<GeneralOutput>>('/agents/general/profile', {})
          .then((r) => live && !r.fallback && r.output.greeting && setLine({ text: r.output.greeting, fallback: false }))
          .catch(() => {});
      })
      .catch((e) => live && fail(e));
    return () => {
      live = false;
    };
  }, [playerId, fail]);

  const appearanceKey = p?.general ? JSON.stringify(p.general.appearance) : null;
  useEffect(() => {
    if (!host.current || !p?.general) return;
    let s: CharacterStage | null = null;
    try {
      s = new CharacterStage(host.current, { scrollable: true });
      s.setAppearance(p.general.appearance);
      s.setSpin(0.5);
    } catch {
      /* WebGL unavailable: the portrait card below still shows the General */
    }
    return () => s?.dispose();
    // Rebuild only when the General's look changes, not on every profile object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appearanceKey]);

  /** Anyone can re-run a replay: fetch the bytes and re-simulate them on this phone (in a worker). */
  const verify = async (b: BattleDTO) => {
    setChecked((c) => ({ ...c, [b.battleId]: 'running' }));
    try {
      const r = await api.get<{ replay: string; seed: `0x${string}`; baseHash: `0x${string}`; replayHash: `0x${string}` }>(`/battle/${b.battleId}/replay`);
      const report = await workerSims().verify(base64ToBytes(r.replay), {
        seed: r.seed,
        baseHash: r.baseHash,
        replayHash: r.replayHash,
        stars: b.stars ?? undefined,
        destructionBp: b.destructionBp ?? undefined,
      });
      setChecked((c) => ({ ...c, [b.battleId]: report.ok ? 'ok' : 'bad' }));
      toast(report.ok ? 'Checked on your phone ✓ it was fair' : `Mismatch: ${report.reasons.join(', ')}`, report.ok ? 'good' : 'bad');
    } catch (e) {
      setChecked((c) => {
        const n = { ...c };
        delete n[b.battleId];
        return n;
      });
      fail(e);
    }
  };

  const share = async () => {
    if (!p || sharing) return;
    setSharing(true);
    try {
      const png = await drawCard(p);
      if (Capacitor.isNativePlatform()) {
        // Android's share sheet takes files, not data: URLs — the app's plugin writes the PNG first.
        await RealmNative.shareImage({ base64: png, fileName: 'realm-raiders-general.png', title: 'My General', text: 'Realm Raiders — every raid is provable.' });
      } else {
        const a = document.createElement('a');
        a.href = `data:image/png;base64,${png}`;
        a.download = 'realm-raiders-general.png';
        a.click();
      }
    } catch (e) {
      if (!/cancel/i.test((e as Error)?.message ?? '')) fail(e);
    } finally {
      setSharing(false);
    }
  };

  if (!p)
    return (
      <div className="screen">
        <Header title="Profile" onBack={back} />
        <Spinner label="Loading your profile…" />
      </div>
    );
  const g = p.general;
  const verified = p.battles.filter((b) => b.status === 'recorded' || b.status === 'verified').length;
  const personality = g ? PERSONALITIES.find((x) => x.id === g.personality)?.name : null;
  return (
    <div className="screen" data-testid="profile">
      <div className="split wide-right" style={{ alignItems: 'start' }}>
        <div className="col" style={{ position: 'sticky', top: 0 }}>
          <Header title={g?.name ?? 'Your General'} subtitle={g ? `${personality} · ${FACTIONS.find((f) => f.id === g.faction)?.name}` : ''} onBack={back} />
          <div ref={host} className="panel" style={{ height: 'min(52vh, 220px)', padding: 0, overflow: 'hidden', touchAction: 'pan-y', background: 'radial-gradient(circle at 50% 70%, #3f7a3a, #1d3a24 70%)' }} data-testid="profile-stage" />
          <div className="row" style={{ justifyContent: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span className="chip brass">{p.rank.name}</span>
            <span className="chip">{p.renown} Renown</span>
            {p.rank.next ? <span className="chip">next rank at {p.rank.next.min}</span> : null}
          </div>
          <div className="grid2">
            <button className="btn small" onClick={share} disabled={sharing} data-testid="share-card">
              <Share2 size={16} /> {sharing ? 'Drawing…' : 'Share card'}
            </button>
            <button className="btn ghost small" onClick={signOut}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        </div>
        <div className="col" style={{ minWidth: 0 }}>
          <div className="tabs">
            {(['General', 'Badges', 'Battles', 'Gems'] as const).map((t) => (
              <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)} data-testid={`profile-tab-${t}`}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'General' ? (
            <div className="col fade-in">
              <div className="card">
                <b style={{ fontSize: 16 }}>
                  {g?.name ?? 'Your General'}
                  {personality ? ` the ${personality}` : ''} · {p.rank.name} · {p.renown} Renown
                  {p.rank.next ? ` · next rank at ${p.rank.next.min}` : ''}
                </b>
              </div>
              <OfficerBubble role="general" name={g?.name ?? 'General'} fallback={line?.fallback ?? true} portrait={g?.portraitUrl}>
                {line?.text ?? p.line}
              </OfficerBubble>
              <div className="grid2">
                <div className="panel">
                  <div className="muted tiny">RAIDS</div>
                  <b style={{ fontSize: 17 }}>
                    {p.record.raidsWon} won · {p.record.raidsLost} lost
                  </b>
                </div>
                <div className="panel">
                  <div className="muted tiny">DEFENCES</div>
                  <b style={{ fontSize: 17 }}>
                    {p.record.defencesWon} held · {p.record.defencesLost} lost
                  </b>
                </div>
              </div>
              <div className="card" data-testid="erc8004-card">
                <div className="row">
                  <ShieldCheck size={18} />
                  <b style={{ flex: 1 }}>On-chain ID #{g?.agentId ?? '—'}</b>
                  <ChainChip tx={g?.agentTx} label="Registered" />
                </div>
                <div style={{ fontSize: 13, marginTop: 4, fontWeight: 700 }}>
                  Agent #{g?.agentId ?? '—'} · {p.reputation.count} verified battle{p.reputation.count === 1 ? '' : 's'} · average score {p.reputation.average}/100
                  {p.reputation.source === 'cached' ? ' (cached)' : ''}
                </div>
                <div className="muted" style={{ fontSize: 13 }}>
                  Owner{' '}
                  {p.chainMode === 'live' ? (
                    <a href={explorerAddress(config.explorerUrl, p.player.address)} target="_blank" rel="noreferrer" className="mono">
                      {shortHash(p.player.address, 8, 6)}
                    </a>
                  ) : (
                    <span className="mono">{shortHash(p.player.address, 8, 6)}</span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  {p.chainMode === 'mock'
                    ? `${mode === 'local' ? 'Offline realm' : 'Server'} · on this phone`
                    : `Monad testnet · ${Object.entries(p.contracts)
                        .map(([k, v]) => `${k} ${shortHash(v)}`)
                        .join(' · ')}`}
                </div>
              </div>
            </div>
          ) : null}
          {tab === 'Badges' ? (
            <div className="grid3 fade-in" data-testid="profile-badges">
              {p.badges.map((b) => (
                <div key={b.id} className={b.earned ? 'card' : 'panel'} style={{ opacity: b.earned ? 1 : 0.5, textAlign: 'center', padding: 8 }} title={b.desc}>
                  <div style={{ fontSize: 26 }}>{b.earned ? '🏅' : '◌'}</div>
                  <div className="num" style={{ fontSize: 13 }}>
                    {b.name}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{b.desc}</div>
                </div>
              ))}
            </div>
          ) : null}
          {tab === 'Battles' ? (
            <div className="col fade-in" data-testid="profile-battles">
              <div className="muted" style={{ fontWeight: 700 }}>
                {verified ? `${verified} verified battle${verified === 1 ? '' : 's'}. ` : ''}Tap VERIFY to check one on this phone.
              </div>
              {p.battles.map((b) => {
                const state = checked[b.battleId];
                return (
                  <div key={b.battleId} className="panel row" style={{ gap: 8, padding: '6px 10px' }} data-testid="battle-row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 14 }}>
                        {b.kind === 'raid' ? `vs ${b.defender}` : `Defence vs ${b.attacker}`} · {b.stars ?? 0}★ {((b.destructionBp ?? 0) / 100).toFixed(0)}%
                      </b>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {b.status} · {b.replayHash ? shortHash(b.replayHash) : ''}
                      </div>
                      {state === 'ok' ? (
                        <div className="good-text" style={{ fontSize: 12 }}>
                          Checked on your phone ✓ fair
                        </div>
                      ) : null}
                    </div>
                    <Stars n={b.stars ?? 0} />
                    {b.replayHash ? (
                      <button className={`btn small ${state === 'ok' ? 'good' : state === 'bad' ? 'danger' : 'info'}`} onClick={() => verify(b)} disabled={state === 'running'} data-testid="verify-btn">
                        {state === 'running' ? '…' : state === 'ok' ? '✓' : state === 'bad' ? '✗' : 'VERIFY'}
                      </button>
                    ) : null}
                  </div>
                );
              })}
              {!p.battles.length ? <div className="card">No battles yet. Raid a holdfast and it will appear here.</div> : null}
            </div>
          ) : null}
          {tab === 'Gems' ? (
            <div className="col fade-in" data-testid="profile-gems">
              <div className="card row">
                <Gem size={22} color="#9b2fc0" />
                <b className="num" style={{ fontSize: 22 }}>
                  {gems?.balance ?? home?.economy.gems ?? 0} Gems
                </b>
                <span className="muted" style={{ fontWeight: 700 }}>
                  Earned by playing — Gems can not be bought.
                </span>
              </div>
              <div className="muted" style={{ fontWeight: 700 }}>
                Log in daily +2 · First raid of the day +5 · 3-star raid +3 · New badge +10 · Win a friend duel +5.
              </div>
              <div className="section-title">Gems history</div>
              <div className="col" style={{ gap: 4 }} data-testid="gems-history">
                {(gems?.history ?? []).map((g) => (
                  <div key={g.id} className="panel row" style={{ padding: '6px 10px', gap: 10 }}>
                    <b className="num" style={{ minWidth: 44, color: g.delta >= 0 ? 'var(--good)' : 'var(--bad)' }}>
                      {g.delta >= 0 ? '+' : '−'}
                      {Math.abs(g.delta)}
                    </b>
                    <span style={{ flex: 1, fontWeight: 700 }}>{g.label}</span>
                    {g.at ? <span className="muted" style={{ fontSize: 12 }}>{new Date(g.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> : null}
                  </div>
                ))}
                {!gems ? <div className="muted">Loading…</div> : null}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
