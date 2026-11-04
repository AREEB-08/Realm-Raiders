import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';
import type { ServerEnv } from './env';

const enc = (s: string) => new TextEncoder().encode(s);

export function sessionIssuer(env: ServerEnv) {
  const key = enc(env.SESSION_JWT_SECRET);
  return {
    async sign(playerId: string) {
      return new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(playerId)
        .setIssuedAt()
        .setExpirationTime('7d')
        .setIssuer('realm-raiders')
        .sign(key);
    },
    async verify(token: string): Promise<string | null> {
      try {
        const { payload } = await jwtVerify(token, key, { issuer: 'realm-raiders' });
        return payload.sub ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Privy access-token verification (ES256 JWT, issuer `privy.io`, audience = app id) against the
 * app's JWKS, then (when the app secret is set) the embedded wallet address from Privy's user API.
 */
export function privyVerifier(env: ServerEnv) {
  if (!env.PRIVY_APP_ID) return null;
  const jwks = createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${env.PRIVY_APP_ID}/jwks.json`));
  return {
    async verify(token: string, claimedAddress?: string): Promise<{ sub: string; address: `0x${string}` } | null> {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: 'privy.io', audience: env.PRIVY_APP_ID });
        const sub = payload.sub;
        if (!sub) return null;
        let address = claimedAddress as `0x${string}` | undefined;
        if (env.PRIVY_APP_SECRET) {
          const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(sub)}`, {
            headers: {
              authorization: `Basic ${Buffer.from(`${env.PRIVY_APP_ID}:${env.PRIVY_APP_SECRET}`).toString('base64')}`,
              'privy-app-id': env.PRIVY_APP_ID!,
            },
          });
          if (res.ok) {
            const user = (await res.json()) as { linked_accounts?: { type: string; address?: string; wallet_client_type?: string }[] };
            const w = user.linked_accounts?.find((a) => a.type === 'wallet' && a.wallet_client_type === 'privy');
            if (w?.address) address = w.address as `0x${string}`;
          }
        }
        if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
        return { sub, address };
      } catch {
        return null;
      }
    },
  };
}
