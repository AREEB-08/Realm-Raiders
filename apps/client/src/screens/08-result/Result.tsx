import { useEffect, useState } from 'react';
import { CheckCircle2, Home as HomeIcon, PlayCircle, ShieldCheck, XCircle } from 'lucide-react';
import { sfx } from '../../audio/sfx';
import { music } from '../../audio/music';
import { shortHash } from '@realm/shared';
import { mmss } from '../../ui/time';
import { useStore } from '../../state';
import { ChainChip, OfficerBubble, Stars, useCountUp } from '../../ui/components';

/** 08 — Result + Verify: stars, Renown, loot, the Intel report and the four-row proof panel. */
export function Result() {
  const { battle, setBattle, go, replace, refreshHome } = useStore();
  const [leaving, setLeaving] = useState(false);
  const [proof, setProof] = useState(false);
  useEffect(() => {
    music.play('home');
  }, []);
  const sub = battle?.submit;
  const r = sub?.result;
  const renown = useCountUp(r?.renown ?? 0);
  const gold = useCountUp(r?.loot.gold ?? 0);
  const timber = useCountUp(r?.loot.timber ?? 0);
  if (!battle) return null;
  const home = async () => {
    setLeaving(true);
    await refreshHome();
    setBattle(null);
    replace('home');
  };
  const win = r ? r.stars > 0 : false;
  return (
    <div className="screen">
      <div className="split wide-right" style={{ alignItems: 'start' }}>
        <div className="col" style={{ textAlign: 'center', gap: 6 }}>
          <div className="title" style={{ fontSize: 34, color: win ? '#ffe08a' : '#ffb0a0' }}>
            {r ? (win ? 'VICTORY' : 'DEFEAT') : sub ? 'Replay rejected' : 'Raid over'}
          </div>
          <div className="subtitle">vs {battle.commit.targetName}</div>
          <div style={{ margin: '0 0 2px', transform: 'scale(0.8)' }}>
            <Stars n={r?.stars ?? 0} big animate />
          </div>
      {r ? (
        <div className="grid3">
          <div className="panel">
            <div className="num" style={{ fontSize: 22 }}>
              {Math.round(r.destructionPct)}%
            </div>
            <div className="muted tiny">RAZED</div>
          </div>
          <div className="panel">
            <div className="num" style={{ fontSize: 22, color: 'var(--renown)' }}>
              +{renown}
            </div>
            <div className="muted tiny">RENOWN</div>
          </div>
          <div className="panel">
            <div className="num" style={{ fontSize: 15, color: 'var(--gold)' }}>
              +{gold} 🪙
            </div>
            <div className="num" style={{ fontSize: 15, color: 'var(--timber)' }}>
              +{timber} 🪵
            </div>
          </div>
        </div>
      ) : null}
      {sub?.gems?.length ? <GemChime /> : null}
      {sub?.gems?.length || sub?.badges.length ? (
        <div className="row" style={{ justifyContent: 'center', gap: 5, marginTop: 8, flexWrap: 'wrap' }} data-testid="result-gems">
          {(sub.gems ?? []).map((g) => (
            <span key={g.label} className="chip gems">
              💎 +{g.delta} {g.label}
            </span>
          ))}
          {sub.badges.map((b) => (
            <span key={b.id} className="chip brass">
              🏅 {b.name}
            </span>
          ))}
        </div>
      ) : null}
      <div className="result-actions">
        {battle.input ? (
          <button className="btn ghost" onClick={() => (setBattle({ ...battle, replay: true }), go('battle'))}>
            <PlayCircle size={18} /> Watch replay
          </button>
        ) : (
          <span />
        )}
        <button className="btn" disabled={leaving} onClick={home} data-testid="return-home">
          <HomeIcon size={18} /> Return home
        </button>
      </div>
        </div>
        <div className="col">
      <div className="card" style={{ textAlign: 'left' }} data-testid="verified-panel">
        <h3 className="row" style={{ fontSize: 16 }}>
          <ShieldCheck size={18} /> {sub?.verified ? 'Fair play verified ✓' : sub ? 'Replay rejected — no Renown' : 'Not submitted'}
        </h3>
        <div className="muted" style={{ fontSize: 13, fontWeight: 700 }}>
          {sub?.verified
            ? battle.commit.chainMode === 'live'
              ? 'The server re-played your battle and it matched. The result is recorded on Monad.'
              : 'The server re-played your battle and it matched.'
            : sub
              ? sub.reasons.join(', ')
              : ''}
        </div>
        <button className="btn ghost small" style={{ marginTop: 6 }} onClick={() => setProof((x) => !x)} data-testid="proof-toggle">
          {proof ? 'Hide details' : 'How we know'}
        </button>
        {proof ? (
          <div className="fade-in">
            <div className="verified-row">
              <span className="tick">
                <CheckCircle2 size={16} />
              </span>
              <span style={{ flex: 1 }}>Battle dice locked before it began</span>
              <ChainChip tx={battle.commit.revealTx} label="seed" />
            </div>
            <div className="verified-row">
              {sub?.verified ? (
                <span className="tick">
                  <CheckCircle2 size={16} />
                </span>
              ) : (
                <span className="cross">
                  <XCircle size={16} />
                </span>
              )}
              <span style={{ flex: 1 }}>Server re-play {sub?.verified ? 'matches' : 'does not match'}</span>
              <span className="mono">{sub ? shortHash(sub.replayHash, 6, 4) : '—'}</span>
            </div>
            <div className="verified-row">
              <span className={sub?.resultTx ? 'tick' : 'cross'}>{sub?.resultTx ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
              <span style={{ flex: 1 }}>Result recorded</span>
              <ChainChip tx={sub?.resultTx} label="result" />
            </div>
            {sub?.feedbackTx ? (
              <div className="verified-row">
                <span className="tick">
                  <CheckCircle2 size={16} />
                </span>
                <span style={{ flex: 1 }}>Your General's reputation</span>
                <ChainChip tx={sub.feedbackTx} label="feedback" />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {sub ? (
        <div style={{ textAlign: 'left', marginTop: 10 }}>
          <OfficerBubble role="intel" name="Whisper">
            <b>{sub.report.headline}</b>
            <ul style={{ margin: '4px 0 0' }}>
              {sub.report.keyMoments.slice(0, 2).map((k, i) => (
                <li key={i}>{k.text.includes(':') ? k.text : `${mmss(k.tick)} ${k.text}`}</li>
              ))}
            </ul>
          </OfficerBubble>
        </div>
      ) : null}
        </div>
      </div>
    </div>
  );
}

/** The Gems a raid earned get their own little sparkle (once, when the result appears). */
function GemChime() {
  useEffect(() => {
    const t = setTimeout(() => sfx.play('gem'), 700);
    return () => clearTimeout(t);
  }, []);
  return null;
}
