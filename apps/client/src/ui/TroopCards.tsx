import { ARMY_TROOPS, TROOPS, troopHitDamage, troopHp, type TroopId } from '@realm/game-data';

const TARGETS: Record<string, string> = { nearest: 'Nearest anything', walls: 'Walls first', defences: 'Defences first', resources: 'Stores first' };
const ICON: Record<TroopId, string> = { shield: '🗡', longbow: '🏹', sapper: '💣', ravager: '🗿', drake: '🐉', general: '⚔', mage: '🔥' };

/** Damage line: "12 every 1 s", "3 × 22 every 1.6 s", "160 once". */
function damageText(id: TroopId, level: number) {
  const d = TROOPS[id];
  const hit = troopHitDamage(id, level);
  if (d.detonates) return `${hit} once`;
  const every = `every ${(d.attackTicks / 20).toFixed(d.attackTicks % 20 ? 1 : 0)} s`;
  return d.volley && d.volley > 1 ? `${d.volley} × ${hit} ${every}` : `${hit} ${every}`;
}

/** The Army troop cards (spec §4 copy and labels). */
export function TroopCards({ level = 1 }: { level?: number }) {
  return (
    <div className="grid2" data-testid="troop-cards">
      {[...ARMY_TROOPS, 'general' as const].map((id) => {
        const d = TROOPS[id];
        return (
          <div key={id} className="card" style={{ padding: 8 }} data-testid={`troop-card-${id}`}>
            <div className="row" style={{ gap: 6 }}>
              <span style={{ fontSize: 22 }}>{ICON[id]}</span>
              <b className="num" style={{ fontSize: 16, flex: 1 }}>
                {d.name}
              </b>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, margin: '2px 0 4px' }}>{d.blurb}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 8, fontSize: 12 }}>
              <span className="muted">Housing space</span>
              <b>{id === 'general' ? '—' : d.housing}</b>
              <span className="muted">Hit points</span>
              <b>{troopHp(id, level)}</b>
              <span className="muted">Damage</span>
              <b>{damageText(id, level)}</b>
              <span className="muted">Range</span>
              <b>{(d.range / 1000).toFixed(1)} tiles</b>
              <span className="muted">Targets</span>
              <b>{TARGETS[d.targets]}</b>
              <span className="muted">Flies</span>
              <b>{d.flies ? 'Yes' : 'No'}</b>
            </div>
          </div>
        );
      })}
    </div>
  );
}
