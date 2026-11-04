import { useEffect, useState } from 'react';
import { Mail, Shield, UserRound } from 'lucide-react';
import type { HomeDTO, SessionDTO } from '@realm/shared';
import { useWallet } from '../../auth/bridge';
import { api } from '../../net/api';
import { config } from '../../net/config';
import { useReset, useStore } from '../../state';
import { sfx } from '../../audio/sfx';
import './signin.css';

type Phase = 'idle' | 'google' | 'email' | 'otp-sent' | 'verifying' | 'forging' | 'error';

/** 01 — Sign in: Google / email via Privy (silent embedded wallet), or a Guest commander. */
export function SignIn() {
  const wallet = useWallet();
  const { fail, mode } = useStore();
  const reset = useReset();
  const [phase, setPhase] = useState<Phase>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [crestTaps, setCrestTaps] = useState(0);

  const finish = async (s: { session: string; playerId: string }) => {
    setPhase('forging');
    sfx.play('seal');
    await api.setSession(s.session, s.playerId);
    const [home] = await Promise.all([api.get<HomeDTO>('/home'), new Promise((r) => setTimeout(r, 2000))]);
    reset({ name: home.general ? 'home' : 'general' });
  };

  const guest = async () => {
    try {
      setPhase('verifying');
      const r = await api.post<SessionDTO & { session?: string }>('/auth/demo');
      await finish({ session: r.session ?? r.playerId, playerId: r.playerId });
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
      fail(e);
    }
  };

  // When Privy reports an authenticated user, exchange its token for a game session.
  useEffect(() => {
    if (!wallet?.authenticated || !wallet.address || phase === 'forging') return;
    void (async () => {
      try {
        if (api.mode === 'local') {
          // Offline build: the in-app world has no Privy verifier; play as a local commander.
          return guest();
        }
        const token = await wallet.getAccessToken();
        if (!token) return;
        const r = await api.post<SessionDTO>('/auth/session', { authToken: token, address: wallet.address });
        await finish({ session: r.session, playerId: r.playerId });
      } catch (e) {
        setPhase('error');
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.authenticated, wallet?.address]);

  const google = async () => {
    if (!wallet) return;
    setPhase('google');
    try {
      await wallet.loginGoogle();
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
    }
  };

  const sendCode = async () => {
    if (!wallet) return;
    try {
      setPhase('verifying');
      await wallet.sendEmailCode(email.trim());
      setPhase('otp-sent');
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
    }
  };

  const verify = async () => {
    if (!wallet) return;
    try {
      setPhase('verifying');
      await wallet.loginWithCode(code.trim());
    } catch (e) {
      setPhase('error');
      setError((e as Error).message);
    }
  };

  const privyReady = !!wallet;
  return (
    <div className="signin">
      <div className="sky" />
      <div className="sun" />
      <div className="ridge far" />
      <div className="hold" />
      <div className="ridge mid" />
      <div className="ridge near" />
      <div className="embers">
        {Array.from({ length: 14 }, (_, i) => (
          <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i * 0.7) % 6}s` }} />
        ))}
      </div>
      <div className="signin-ui">
        <div className="logo fade-in">
          <div
            className="crest"
            onClick={() => {
              // Hidden: 7 taps open the /dev/sim determinism check (Node vs this WebView).
              const n = crestTaps + 1;
              setCrestTaps(n);
              if (n >= 7) reset({ name: 'devsim' });
            }}
          >
            <Shield size={44} />
          </div>
          <h1>Realm Raiders</h1>
          <p className="flavour">Your island. Your General. Your council — and every raid is provable.</p>
        </div>
        {phase === 'forging' ? (
          <div className="forging fade-in">
            <div className="seal-wax pulse">✦</div>
            <div className="flavour">Forging your seal…</div>
          </div>
        ) : (
          <div className="panel brass col fade-in" style={{ gap: 10 }}>
            <div className="title" style={{ fontSize: 20, textAlign: 'center' }}>
              Raise your banner
            </div>
            {phase === 'email' || phase === 'otp-sent' ? (
              <div className="col">
                {phase === 'email' ? (
                  <>
                    <input className="field" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                    <button className="btn block" disabled={!email.includes('@')} onClick={sendCode}>
                      Send code
                    </button>
                  </>
                ) : (
                  <>
                    <div className="muted">A code is on its way to {email}.</div>
                    <input className="field" inputMode="numeric" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
                    <button className="btn block" disabled={code.trim().length < 6} onClick={verify}>
                      Verify
                    </button>
                  </>
                )}
                <button className="btn ghost small" onClick={() => setPhase('idle')}>
                  Back
                </button>
              </div>
            ) : (
              <>
                <button className="btn info big block" disabled={!privyReady || phase === 'google'} onClick={google}>
                  <span className="g">G</span> {phase === 'google' ? 'Waiting for Google…' : 'Continue with Google'}
                </button>
                <button className="btn ghost big block" disabled={!privyReady} onClick={() => setPhase('email')}>
                  <Mail size={18} /> Continue with email
                </button>
                {(config.demo || !privyReady) && (
                  <button className="btn ember big block" disabled={phase === 'verifying'} onClick={guest} data-testid="guest">
                    <UserRound size={18} /> {phase === 'verifying' ? 'Opening the gates…' : 'Guest commander'}
                  </button>
                )}
                {!privyReady && <div className="muted small-note">Google and email sign-in need a Privy app id (VITE_PRIVY_APP_ID).</div>}
              </>
            )}
            {phase === 'error' && error ? (
              <div className="banner">
                {error}{' '}
                <button className="btn ghost small" onClick={() => setPhase('idle')}>
                  Retry
                </button>
              </div>
            ) : null}
            <div className="muted small-note">{mode === 'local' ? 'Playing on this phone — no internet needed.' : 'Connected to the realm server.'}</div>
          </div>
        )}
      </div>
    </div>
  );
}
