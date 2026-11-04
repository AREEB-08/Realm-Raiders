import { useEffect, useState } from 'react';
import { CheckCircle2, Sunrise, Wand2, XCircle } from 'lucide-react';
import type { AutoSessionDTO, NightReportDTO } from '@realm/shared';
import { gameCtl } from '../../game/controller';
import { api } from '../../net/api';
import { useStore } from '../../state';
import { ChainChip, Header, OfficerBubble, Spinner, Stars } from '../../ui/components';
import { MiniMap } from '../../ui/MiniMap';
import { AutoLogView } from '../../ui/auto';

type Tab = 'night' | 'auto';

function Tabs({ tab, set, auto }: { tab: Tab; set(t: Tab): void; auto: boolean }) {
  return (
    <div className="tabs" style={{ marginBottom: 6 }}>
      <button className={tab === 'night' ? 'on' : ''} onClick={() => set('night')} data-testid="tab-night-report">
        Night Report
      </button>
      <button className={tab === 'auto' ? 'on' : ''} onClick={() => set('auto')} data-testid="tab-auto-log" disabled={!auto}>
        Auto Log
      </button>
    </div>
  );
}

/** 10 — Morning Report: what the Night Captain did, inside the sealed orders, and the Architect's fix; plus the Auto Log. */
export function Report() {
  const { home, back, go, fail, replace, route } = useStore();
  const [report, setReport] = useState<NightReportDTO | null | undefined>(undefined);
  const [auto, setAuto] = useState<AutoSessionDTO | null>(null);
  const [tab, setTab] = useState<Tab>(route.params?.tab === 'auto' ? 'auto' : 'night');
  useEffect(() => {
    const load = () =>
      api
        .get<{ session: AutoSessionDTO | null }>('/auto')
        .then((r) => setAuto(r.session))
        .catch(() => {});
    void load();
    // A running session keeps writing its log.
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (home) gameCtl.showIsland({ layout: home.base.layout, mode: 'preview', faction: home.general?.faction, look: 'dawn' });
  }, [home]);
  useEffect(() => {
    api
      .get<{ report: NightReportDTO | null }>('/night/report')
      .then((r) => setReport(r.report))
      .catch((e) => {
        fail(e);
        setReport(null);
      });
  }, [fail]);
  if (report === undefined) return <div className="screen dawn"><Spinner label="The watch reports in…" /></div>;
  if (tab === 'auto' && auto)
    return (
      <div className="screen dawn">
        <Header title="Auto Log" subtitle="Every move your officers made, checked against the sealed orders" onBack={back} />
        <Tabs tab={tab} set={setTab} auto />
        <AutoLogView session={auto} general={home?.general?.name ?? 'Your General'} />
      </div>
    );
  if (!report)
    return (
      <div className="screen dawn">
        <Header title="Morning Report" onBack={back} />
        <Tabs tab="night" set={setTab} auto={!!auto} />
        <div className="card">Nothing happened last night. Give the Night Captain tonight's orders.</div>
      </div>
    );
  const a = report.architect;
  return (
    <div className="screen dawn">
      <Header title="Morning Report" subtitle={`Night ${String(report.nightId).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}`} onBack={back} right={<Sunrise color="var(--ember-hi)" />} />
      <Tabs tab="night" set={setTab} auto={!!auto} />
      <div className="split">
      <div className="col" style={{ gap: 6 }}>
      <OfficerBubble role="intel" name="Whisper" fallback>
        <b>{report.intel.headline}</b>
      </OfficerBubble>
      <div className="section-title">The night's raids</div>
      <div className="col">
        {report.attacks.map((x, i) => (
          <div key={i} className="panel col" style={{ gap: 6 }}>
            <div className="row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{x.attacker}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  Citadel {x.attackerCitadel} · {x.blocked ? 'turned back at the storm-shield' : `${Math.round(x.destructionPct)}% taken`}
                </div>
              </div>
              {!x.blocked ? <Stars n={x.stars} /> : null}
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className={`chip ${x.renownDelta >= 0 ? 'good' : 'bad'}`}>
                Renown {x.renownDelta >= 0 ? '+' : ''}
                {x.renownDelta}
              </span>
              {x.resultTx ? <ChainChip tx={x.resultTx} label="DefenseRecorded" /> : null}
            </div>
          </div>
        ))}
      </div>
      <div className="section-title">Autopilot actions</div>
      <div className="col">
        {report.actions.map((x, i) => (
          <div key={i} className="panel row" style={{ gap: 8, padding: '8px 10px' }}>
            {x.allowed ? <CheckCircle2 size={16} color="var(--good)" /> : <XCircle size={16} color="var(--bad)" />}
            <div style={{ flex: 1, fontSize: 13 }}>
              {x.text}
              <div className="muted" style={{ fontSize: 11 }}>
                {x.allowed ? 'within orders ✓' : `refused: ${x.reason}`}
              </div>
            </div>
            {x.tx ? <ChainChip tx={x.tx} label="Autopilot" /> : null}
          </div>
        ))}
        {!report.actions.length ? <div className="muted">No actions were needed.</div> : null}
      </div>
      <div className="row" style={{ margin: '8px 0', flexWrap: 'wrap' }}>
        <span className="chip good">Orders seal {report.policyHash.slice(0, 10)}…</span>
        <ChainChip tx={report.policyTx} label="PolicyCommitted" />
      </div>
      </div>
      <div className="col" style={{ gap: 6 }}>
      <div className="section-title">Architect's review</div>
      <OfficerBubble role="architect" name="Master Mason Orrin" fallback={a.agent.fallback}>
        <ul style={{ margin: 0, paddingLeft: 16 }}>
          {a.tips.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
        {a.patch ? <div style={{ marginTop: 4 }}>{a.patch.rationale}</div> : null}
      </OfficerBubble>
      {a.patch && home ? (
        <div className="panel" style={{ marginTop: 8, padding: 6 }}>
          <MiniMap layout={home.base.layout} ghostMoves={a.patch.moves} height={190} banner="#3f6b3a" />
          {a.after ? (
            <div className="row" style={{ justifyContent: 'center', gap: 10, fontSize: 12, marginTop: 4 }}>
              <span>Citadel covered: {a.before.coveredCitadelPct}% → {a.after.coveredCitadelPct}%</span>
              <span>Weakest flank: {Math.min(...a.before.quadrants.map((q) => q.coverage))}% → {Math.min(...a.after.quadrants.map((q) => q.coverage))}%</span>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="col" style={{ marginTop: 14 }}>
        {a.patch ? (
          <button className="btn ember big block" onClick={() => go('build', { patch: a.patch!.moves })} data-testid="apply-architect">
            <Wand2 size={18} /> Apply Architect fix
          </button>
        ) : null}
        <button className="btn ghost block" onClick={() => replace('home')}>
          Dismiss
        </button>
      </div>
      </div>
      </div>
    </div>
  );
}
