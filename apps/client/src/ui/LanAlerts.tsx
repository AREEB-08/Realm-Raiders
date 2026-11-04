import { useEffect, useState } from 'react';
import { Eye, Zap } from 'lucide-react';
import { channels, type DuelDTO } from '@realm/shared';
import { api } from '../net/api';
import { useStore } from '../state';
import { sfx } from '../audio/sfx';

/**
 * Personal LAN alerts, on every screen while in a friend's room (spec F9):
 * "Ayaan is raiding you! WATCH LIVE", duel challenges, and the duel starting.
 */
export function LanAlerts() {
  const { home, go, route, toast, fail } = useStore();
  const me = home?.player.id ?? null;
  const [raid, setRaid] = useState<{ battleId: string; text: string } | null>(null);
  const [invite, setInvite] = useState<{ duelId: string; text: string } | null>(null);
  const inRoom = !!api.lan;

  useEffect(() => {
    if (!inRoom || !me) return;
    api.connect();
    const off = api.subscribe(channels.player(me), (m) => {
      const d = m.d as Record<string, unknown>;
      if (m.t === 'raid-alert') {
        sfx.play('alert');
        setRaid({ battleId: String(d.battleId), text: String(d.text) });
      } else if (m.t === 'duel-invite') {
        sfx.play('duel');
        setInvite({ duelId: String(d.duelId), text: String(d.text) });
      } else if (m.t === 'duel-declined') toast(`${String(d.name)} declined the duel.`, 'info');
      else if (m.t === 'duel-start') {
        setInvite(null);
        sfx.play('duel');
        go('duel', { duelId: (d as unknown as DuelDTO).duelId });
      }
    });
    return off;
  }, [inRoom, me, go, toast]);

  if (!inRoom) return null;
  return (
    <>
      {raid && route.name !== 'spectate' ? (
        <div className="lan-alert fade-in" data-testid="raid-alert">
          <b>{raid.text}</b>
          <button
            className="btn danger small"
            onClick={() => {
              setRaid(null);
              go('spectate', { battleId: raid.battleId });
            }}
            data-testid="watch-live"
          >
            <Eye size={14} /> WATCH LIVE
          </button>
          <button className="icon-btn" onClick={() => setRaid(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ) : null}
      {invite ? (
        <div className="lan-alert fade-in" data-testid="duel-invite">
          <b>
            <Zap size={14} /> {invite.text}
          </b>
          <button
            className="btn go small"
            onClick={() =>
              void api.post(`/duel/${invite.duelId}/accept`).catch((e) => {
                setInvite(null);
                fail(e);
              })
            }
            data-testid="accept-duel"
          >
            ACCEPT
          </button>
          <button
            className="btn ghost small"
            onClick={() => {
              void api.post(`/duel/${invite.duelId}/decline`).catch(() => {});
              setInvite(null);
            }}
          >
            DECLINE
          </button>
        </div>
      ) : null}
    </>
  );
}
