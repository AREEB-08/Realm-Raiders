import { useEffect, useState } from 'react';
import { Lock, Moon, Sparkles, Swords } from 'lucide-react';
import {
  describePolicy,
  nightOf,
  shortHash,
  type NightCaptainOutput,
  type NightPolicy,
  type NightPolicyDTO,
  type PolicyDraft,
} from '@realm/shared';
import { useWallet } from '../../auth/bridge';
import { commitPolicy } from '../../chain/tx';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { config } from '../../net/config';
import { useStore } from '../../state';
import { ChainChip, Header, OfficerBubble } from '../../ui/components';
import { sfx } from '../../audio/sfx';

const DEFAULT: PolicyDraft = { repairPriority: 'walls', reserveGoldPct: 30, autoRetaliate: true, maxRetaliateCitadelDelta: 0, shieldIfLossesOverPct: 60 };

/** 09 — Night Captain: draft, approve and seal tonight's autopilot orders. */
export function Night() {
  const { home, back, fail, go, toast, refreshHome } = useStore();
  const wallet = useWallet();
  const [policy, setPolicy] = useState<PolicyDraft>(DEFAULT);
  const [sealed, setSealed] = useState<NightPolicyDTO | null>(null);
  const [draft, setDraft] = useState<{ lines: string[]; fallback: boolean } | null>(null);
  const [busy, setBusy] = useState<'draft' | 'seal' | 'sim' | null>(null);

  useEffect(() => {
    if (home) gameCtl.showIsland({ layout: home.base.layout, mode: 'preview', faction: home.general?.faction, look: 'night' });
  }, [home]);
  useEffect(() => {
    api
      .get<{ policy: NightPolicyDTO | null }>('/night/policy')
      .then((r) => {
        if (r.policy?.sealed && r.policy.expiresAt * 1000 > Date.now()) {
          setSealed(r.policy);
          const { v: _v, night: _n, ...rest } = r.policy.policy;
          setPolicy(rest);
        }
      })
      .catch(() => {});
  }, []);

  const draftForMe = async () => {
    setBusy('draft');
    try {
      const r = await api.post<{ output: NightCaptainOutput; fallback: boolean }>('/agents/night_captain/draft');
      setPolicy({ ...DEFAULT, ...r.output.policy } as PolicyDraft);
      setDraft({ lines: r.output.explanation, fallback: r.fallback });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const seal = async () => {
    setBusy('seal');
    try {
      const prep = await api.post<NightPolicyDTO>('/night/policy', { policy });
      await commitPolicy(wallet, home?.chainMode ?? 'mock', prep);
      const r = await api.get<{ policy: NightPolicyDTO }>('/night/policy');
      setSealed(r.policy);
      sfx.play('seal');
      toast(`Orders sealed ✓ ${shortHash(prep.policyHash)}`, 'good');
      void refreshHome();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const simulate = async () => {
    setBusy('sim');
    try {
      await api.post('/night/simulate');
      sfx.play('victory');
      go('report');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const full: NightPolicy = { v: 1, night: nightOf(new Date()), ...policy };
  const lock = !!sealed;
  const set = <K extends keyof PolicyDraft>(k: K, v: PolicyDraft[K]) => !lock && setPolicy((p) => ({ ...p, [k]: v }));
  return (
    <div className="overlay" style={{ gap: 8 }}>
      <div className="pass" style={{ maxWidth: '48%' }}>
        <Header title="Night Captain" subtitle="Tonight's orders" onBack={back} right={<Moon color="var(--brass-hi)" />} />
      </div>
      <div className="spacer" />
      <div className="panel brass drawer" style={{ width: 'min(440px, 50vw)', background: 'linear-gradient(180deg, #2a2a52, #161a36)' }} data-testid="night-orders">
        {home && (!home.base.sealedHash || home.base.dirty) ? (
          <div className="banner row" style={{ marginBottom: 8 }} data-testid="night-needs-seal">
            <span style={{ flex: 1 }}>Save your base first (Build → Save) so the night raiders have a base to attack.</span>
            <button className="btn ember small" onClick={() => go('build')}>
              SAVE BASE
            </button>
          </div>
        ) : null}
        <OfficerBubble role="night_captain" name="Watch-Captain Hale" loading={busy === 'draft'} fallback={draft?.fallback}>
          {draft ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {draft.lines.slice(0, 2).map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          ) : lock ? (
            'Your orders are locked. I will not step outside them.'
          ) : (
            "Set tonight's orders, or let me draft them."
          )}
        </OfficerBubble>
        {!lock ? (
          <button className="btn ghost small" style={{ marginTop: 8 }} onClick={draftForMe} disabled={busy !== null} data-testid="draft">
            <Sparkles size={14} /> Draft for me
          </button>
        ) : null}
        <div className="section-title">Repair first</div>
        <div className="pill-toggle">
          {(['walls', 'defenses', 'resources'] as const).map((r) => (
            <button key={r} className={policy.repairPriority === r ? 'on' : ''} onClick={() => set('repairPriority', r)} disabled={lock}>
              {r === 'defenses' ? 'Defences' : r[0]!.toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
        <div className="section-title">Gold kept in reserve: {policy.reserveGoldPct}%</div>
        <input type="range" min={0} max={80} step={5} value={policy.reserveGoldPct} disabled={lock} onChange={(e) => set('reserveGoldPct', Number(e.target.value))} />
        <div className="section-title">Strike back</div>
        <div className="row">
          <div className="pill-toggle">
            <button className={policy.autoRetaliate ? 'on' : ''} disabled={lock} onClick={() => set('autoRetaliate', true)}>
              Yes
            </button>
            <button className={!policy.autoRetaliate ? 'on' : ''} disabled={lock} onClick={() => set('autoRetaliate', false)}>
              No
            </button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            vs Citadel delta ≤ {policy.maxRetaliateCitadelDelta}
          </span>
        </div>
        <input type="range" min={-2} max={2} step={1} value={policy.maxRetaliateCitadelDelta} disabled={lock || !policy.autoRetaliate} onChange={(e) => set('maxRetaliateCitadelDelta', Number(e.target.value))} />
        <div className="section-title">Storm-shield if a raid takes {policy.shieldIfLossesOverPct}%</div>
        <input type="range" min={10} max={100} step={5} value={policy.shieldIfLossesOverPct} disabled={lock} onChange={(e) => set('shieldIfLossesOverPct', Number(e.target.value))} />
        <div className="card" style={{ marginTop: 10 }}>
          {describePolicy(full).map((l, i) => (
            <div key={i} className="flavour" style={{ fontSize: 14 }}>
              • {l}
            </div>
          ))}
        </div>
        {lock ? (
          <div className="col" style={{ marginTop: 10 }}>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="chip good">
                <Lock size={12} /> Sealed until morning · {shortHash(sealed!.policyHash)}
              </span>
              <ChainChip tx={sealed!.commitTx} label="PolicyCommitted" />
            </div>
            {config.demo ? (
              <button className="btn ember block" onClick={simulate} disabled={busy !== null} data-testid="simulate-night">
                <Swords size={16} /> {busy === 'sim' ? 'The night passes…' : 'Simulate tonight'}
              </button>
            ) : null}
          </div>
        ) : (
          <button className="btn ember big block" style={{ marginTop: 12 }} onClick={seal} disabled={busy !== null} data-testid="seal-orders">
            <Lock size={18} /> {busy === 'seal' ? 'Saving…' : "Save tonight's orders"}
          </button>
        )}
      </div>
    </div>
  );
}
