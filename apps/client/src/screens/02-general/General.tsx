import { useEffect, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { FACTIONS, PERSONALITIES } from '@realm/game-data';
import {
  BODIES,
  BODY_NAMES,
  CLOAKS,
  HAIRS,
  HAIR_COLORS,
  HEADS,
  SHIELDS,
  SKIN_TONES,
  WEAPONS,
  defaultAppearance,
  type Appearance,
  type GeneralOutput,
  type TxRef,
} from '@realm/shared';
import { useWallet } from '../../auth/bridge';
import { registerAgent } from '../../chain/tx';
import { registerGeneralSprite } from '../../game/generalSprite';
import { api } from '../../net/api';
import { useReset, useStore } from '../../state';
import { CharacterStage, renderPortrait } from '../../three/CharacterStage';
import { ChainChip, OfficerBubble } from '../../ui/components';
import { sfx } from '../../audio/sfx';
import './general.css';

const TABS = ['Body', 'Head', 'Hair', 'Armour', 'Cloak', 'Weapon', 'Colours'] as const;
type Tab = (typeof TABS)[number];
const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const PALETTE = ['#3f6b3a', '#27527a', '#5b3f7a', '#8a2f2f', '#4b5563', '#e07b28', '#c08a3e', '#e8dfc8', '#1f2a33', '#b07d3c', '#8c8f86', '#6d6a65'];

type Phase = 'editing' | 'minting' | 'done';
const STEPS = ['Writing your General into the roll', 'Painting the portrait', 'Registering your General on Monad', 'Hearing the first words'] as const;

/** 02 — Meet your General: 3D creator, personality, name, faction, and the ERC-8004 agent card. */
export function GeneralScreen() {
  const { home, refreshHome, fail, setGeneralSprite } = useStore();
  const reset = useReset();
  const wallet = useWallet();
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<CharacterStage | null>(null);
  const existing = home?.general ?? null;
  const [a, setA] = useState<Appearance>(existing?.appearance ?? defaultAppearance('thornmarch'));
  const [name, setName] = useState(existing?.name ?? '');
  const [personality, setPersonality] = useState(existing?.personality ?? 'bold');
  const [tab, setTab] = useState<Tab>('Body');
  const [phase, setPhase] = useState<Phase>('editing');
  const [step, setStep] = useState(0);
  const [agent, setAgent] = useState<{ agentId: string; agentTx: TxRef | null } | null>(null);
  const [line, setLine] = useState<{ text: string; fallback: boolean } | null>(null);

  useEffect(() => {
    if (!host.current) return;
    let s: CharacterStage;
    try {
      s = new CharacterStage(host.current);
    } catch (e) {
      // WebGL unavailable: the creator still works, just without the 3D preview.
      console.warn('[art] 3D preview unavailable', e);
      return;
    }
    stage.current = s;
    return () => {
      s.dispose();
      stage.current = null;
    };
  }, []);
  useEffect(() => {
    const t0 = performance.now();
    stage.current?.setAppearance(a);
    if (performance.now() - t0 > 100) console.warn('part swap over 100 ms');
  }, [a]);

  const set = <K extends keyof Appearance>(k: K, v: Appearance[K]) => {
    sfx.play('tap');
    setA((x) => ({ ...x, [k]: v }));
  };
  const setColor = (k: keyof Appearance['colors'], v: string) => setA((x) => ({ ...x, colors: { ...x.colors, [k]: v } }));
  const setFaction = (f: Appearance['faction']) => {
    const d = defaultAppearance(f);
    setA((x) => ({ ...x, faction: f, colors: { ...x.colors, primary: d.colors.primary, secondary: d.colors.secondary, metal: d.colors.metal } }));
  };

  const raise = async () => {
    setPhase('minting');
    stage.current?.celebrate();
    sfx.play('seal');
    try {
      setStep(0);
      await api.put('/general', { name: name.trim(), personality, faction: a.faction, appearance: a });
      setStep(1);
      // The portrait is optional: without WebGL the General still rises (shown as a drawn badge).
      let png: string | null = null;
      try {
        png = renderPortrait(a);
      } catch (e) {
        console.warn('[art] portrait snapshot unavailable', e);
      }
      if (png) await api.post('/general/portrait', { png }).catch(() => null);
      setStep(2);
      const reg = await registerAgent(wallet, home?.chainMode ?? 'mock');
      setAgent(reg);
      setStep(3);
      const greet = await api.post<{ output: GeneralOutput; fallback: boolean }>('/agents/general/greeting');
      setLine({ text: greet.output.greeting, fallback: greet.fallback });
      const h = await refreshHome();
      if (h?.general) setGeneralSprite(registerGeneralSprite(h.general.appearance, h.general.appearanceHash));
      setPhase('done');
      sfx.play('victory');
    } catch (e) {
      fail(e);
      setPhase('editing');
    }
  };

  const options = useMemo(() => {
    switch (tab) {
      case 'Body':
        return BODIES.map((b) => ({ key: b, text: BODY_NAMES[b], on: a.body === b, pick: () => set('body', b) }));
      case 'Head':
        return HEADS.map((h) => ({ key: h, text: label(h), on: a.head === h, pick: () => set('head', h) }));
      case 'Hair':
        return HAIRS.map((h) => ({ key: h, text: label(h), on: a.hair === h, pick: () => set('hair', h) }));
      case 'Cloak':
        return CLOAKS.map((h) => ({ key: h, text: label(h), on: a.cloak === h, pick: () => set('cloak', h) }));
      case 'Weapon':
        return [
          ...WEAPONS.map((w) => ({ key: w, text: label(w), on: a.weapon === w, pick: () => set('weapon', w) })),
          ...[null, ...SHIELDS].map((s) => ({ key: `s-${s}`, text: s ? `${label(s)} shield` : 'No shield', on: a.shield === s, pick: () => set('shield', s) })),
        ];
      default:
        return [];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, a]);

  const valid = name.trim().length >= 2;
  return (
    <div className="creator">
      <div className="creator-stage" ref={host} />
      {phase === 'editing' && (
        <div className="sheet creator-sheet">
          <div className="grab" />
          <div className="row" style={{ gap: 10 }}>
            <div className="title" style={{ fontSize: 20, whiteSpace: 'nowrap' }}>
              Meet your General
            </div>
            <input className="field" maxLength={24} placeholder="Name, e.g. Brannoc" value={name} onChange={(e) => setName(e.target.value)} data-testid="general-name" aria-label="Name" />
          </div>
          <div className="tabs">
            {TABS.map((t) => (
              <button key={t} className={t === tab ? 'on' : ''} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </div>
          {tab === 'Armour' || tab === 'Colours' ? (
            <div className="col">
              {(tab === 'Armour' ? (['primary', 'secondary', 'metal'] as const) : (['skin', 'hair'] as const)).map((k) => (
                <div key={k} className="swatches">
                  <span className="muted">{label(k)}</span>
                  {(k === 'skin' ? SKIN_TONES : k === 'hair' ? HAIR_COLORS : PALETTE).map((c) => (
                    <button key={c} className={`sw${a.colors[k] === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setColor(k, c)} aria-label={c} />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="opts">
              {options.map((o) => (
                <button key={o.key} className={`opt${o.on ? ' on' : ''}`} onClick={o.pick}>
                  {o.on ? <Check size={14} /> : null} {o.text}
                </button>
              ))}
            </div>
          )}
          <div className="section-title">Temper</div>
          <div className="grid2">
            {PERSONALITIES.map((p) => (
              <button key={p.id} className={`card temper${personality === p.id ? ' on' : ''}`} onClick={() => setPersonality(p.id)}>
                <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                <div className="flavour muted" style={{ fontSize: 13 }}>
                  {p.line}
                </div>
              </button>
            ))}
          </div>
          <div className="section-title">Banner</div>
          <div className="factions">
            {FACTIONS.map((f) => (
              <button key={f.id} className={`faction${a.faction === f.id ? ' on' : ''}`} onClick={() => setFaction(f.id)}>
                <span className="flagdot" style={{ background: f.colors.primary, borderColor: f.colors.secondary }} />
                <b>{f.name}</b>
                <small className="muted">{f.terrain}</small>
              </button>
            ))}
          </div>
          <div style={{ position: 'sticky', bottom: -14, paddingTop: 10, paddingBottom: 4, background: 'linear-gradient(180deg, rgba(51,34,15,0), #33220f 30%)' }}>
            <button className="btn ember big block" disabled={!valid} onClick={raise} data-testid="raise">
              Raise your banner
            </button>
          </div>
        </div>
      )}
      {phase !== 'editing' && (
        <div className="sheet creator-sheet">
          <div className="grab" />
          <div className="title" style={{ fontSize: 22 }}>
            {name} the {PERSONALITIES.find((p) => p.id === personality)?.name}
          </div>
          <div className="col" style={{ margin: '10px 0' }}>
            {STEPS.map((s, i) => (
              <div key={s} className="row" style={{ opacity: i <= step ? 1 : 0.4 }}>
                <span className={i < step || phase === 'done' ? 'tick' : i === step ? 'spin' : ''}>{i < step || phase === 'done' ? '✓' : '◌'}</span>
                <span className="flavour">{s}</span>
              </div>
            ))}
          </div>
          {agent ? <ChainChip tx={agent.agentTx} label={`Agent ID #${agent.agentId}`} /> : phase === 'minting' && step >= 2 ? <ChainChip label="Forging agent card" pending /> : null}
          {line ? (
            <div style={{ marginTop: 12 }}>
              <OfficerBubble role="general" name={name} fallback={line.fallback} portrait={home?.general?.portraitUrl}>
                {line.text}
              </OfficerBubble>
            </div>
          ) : null}
          {phase === 'done' && (
            <button className="btn big block" style={{ marginTop: 16 }} onClick={() => reset({ name: 'home' })} data-testid="enter-home">
              Enter your holdfast
            </button>
          )}
        </div>
      )}
    </div>
  );
}
