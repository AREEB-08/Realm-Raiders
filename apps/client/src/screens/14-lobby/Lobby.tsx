import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, LogOut, Swords, Zap } from 'lucide-react';
import { EMOTES, LOBBY_STATUS, channels, type DuelDTO, type EmoteId, type LobbyDTO, type LobbyPlayerDTO } from '@realm/shared';
import { api } from '../../net/api';
import { leaveRoom } from '../../net/lan';
import { useReset, useStore } from '../../state';
import { Header, Spinner } from '../../ui/components';
import { Modal } from '../../ui/hud';
import { sfx } from '../../audio/sfx';

/** 14 — Lobby: who is in the room, READY, emotes, and the three ways to play together (spec F9). */
export function Lobby() {
  const { back, go, fail, toast, refreshHome, home } = useStore();
  const reset = useReset();
  const [lobby, setLobby] = useState<LobbyDTO | null>(null);
  const [bubbles, setBubbles] = useState<{ id: number; from: string; name: string; text: string }[]>([]);
  const [pickDuel, setPickDuel] = useState(false);
  const load = useCallback(
    () =>
      api
        .get<LobbyDTO>('/lan/lobby')
        .then(setLobby)
        .catch((e) => fail(e)),
    [fail],
  );
  useEffect(() => {
    void load();
    const off = api.subscribe(channels.lobby(), (m) => {
      if (m.t === 'lobby') setLobby((l) => (l ? { ...l, players: (m.d as { players: LobbyPlayerDTO[] }).players } : l));
      if (m.t === 'emote') {
        const d = m.d as { from: string; name: string; text: string };
        const b = { id: Date.now() + Math.random(), ...d };
        sfx.play('emote');
        setBubbles((x) => [...x.slice(-4), b]);
        setTimeout(() => setBubbles((x) => x.filter((y) => y.id !== b.id)), 3500);
      }
    });
    const t = setInterval(load, 6000);
    return () => {
      off();
      clearInterval(t);
    };
  }, [load]);

  if (!lobby) return <div className="screen"><Spinner label="Opening the room…" /></div>;
  const me = lobby.players.find((p) => p.playerId === lobby.me);
  const friends = lobby.players.filter((p) => p.playerId !== lobby.me);
  const emote = (e: EmoteId) => void api.post('/lan/emote', { emote: e }).catch(fail);
  const ready = () => void api.post('/lan/ready', { ready: !me?.ready }).then(load).catch(fail);
  const invite = async (to: LobbyPlayerDTO) => {
    setPickDuel(false);
    try {
      await api.post<DuelDTO>('/duel/invite', { to: to.playerId });
      toast(`Challenge sent to ${to.name} — waiting for them to accept…`, 'info');
    } catch (e) {
      fail(e);
    }
  };
  const leave = async () => {
    await leaveRoom();
    await refreshHome();
    reset({ name: 'home' });
  };

  return (
    <div className="screen">
      <Header
        title={`Room ${lobby.room} · ${lobby.players.length} commander${lobby.players.length === 1 ? '' : 's'}`}
        subtitle={`Hosted on ${lobby.hostName}`}
        onBack={back}
        right={
          <button className="btn ghost small" onClick={leave} data-testid="leave-room">
            <LogOut size={14} /> Leave room
          </button>
        }
      />
      <div className="split">
        <div className="col" style={{ gap: 6 }} data-testid="lobby-players">
          {lobby.players.map((p) => (
            <div key={p.playerId} className="card row" style={{ gap: 10, position: 'relative' }} data-testid="lobby-player">
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>
                  {p.name}
                  {p.playerId === lobby.me ? ' (you)' : ''}
                </b>
                <div className="row" style={{ gap: 4, flexWrap: 'wrap', marginTop: 2 }}>
                  <span className={`chip ${p.status === 'island' ? 'good' : 'brass'}`}>{LOBBY_STATUS[p.status]}</span>
                  {!p.online ? <span className="chip bad">Away</span> : null}
                  {!p.sealed ? <span className="chip bad">Base not saved</span> : null}
                  <span className="chip">Renown {p.renown}</span>
                </div>
              </div>
              {p.ready ? (
                <span className="chip good" data-testid="ready-badge">
                  <CheckCircle2 size={12} /> READY
                </span>
              ) : null}
              {bubbles
                .filter((b) => b.from === p.playerId)
                .map((b) => (
                  <span key={b.id} className="emote-bubble fade-in" data-testid="emote-bubble">
                    {b.text}
                  </span>
                ))}
            </div>
          ))}
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn ${me?.ready ? 'go' : 'ghost'}`} onClick={ready} data-testid="ready">
              <CheckCircle2 size={16} /> {me?.ready ? 'READY ✓' : 'READY'}
            </button>
            {(Object.keys(EMOTES) as EmoteId[]).map((e) => (
              <button key={e} className="btn ghost small" onClick={() => emote(e)} data-testid={`emote-${e}`}>
                {EMOTES[e]}
              </button>
            ))}
          </div>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <button className="btn ember big block" disabled={!friends.length} onClick={() => go('targets', { friend: true })} data-testid="mode-raid">
            <Swords size={18} /> RAID FRIEND
          </button>
          <button
            className="btn info big block"
            disabled={!friends.length}
            onClick={() => (friends.length === 1 ? invite(friends[0]!) : setPickDuel(true))}
            data-testid="mode-duel"
          >
            <Zap size={18} /> LIVE DUEL
          </button>
          <p className="small-note" style={{ margin: 0 }}>
            {friends.length
              ? 'Raid a friend’s base while they watch live, or duel each other for 3 minutes.'
              : 'Waiting for a friend to join this room…'}
            {home && !home.base.sealedHash ? ' Save your base (Build → Save) so friends can raid and duel you.' : ''}
          </p>
        </div>
      </div>
      {pickDuel ? (
        <Modal title="Challenge who?" onClose={() => setPickDuel(false)} testId="duel-pick">
          <div className="list2">
            {friends.map((f) => (
              <button key={f.playerId} className="btn info block" onClick={() => invite(f)}>
                {f.name}
              </button>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
