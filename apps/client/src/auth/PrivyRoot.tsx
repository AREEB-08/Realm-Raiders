import {
  PrivyProvider,
  useLoginWithEmail,
  useLoginWithOAuth,
  usePrivy,
  useSendTransaction,
  useSignTypedData,
  useWallets,
} from '@privy-io/react-auth';
import { useMemo, type ReactNode } from 'react';
import { defineChain } from 'viem';
import { MONAD_TESTNET } from '@realm/shared';
import { config } from '../net/config';
import { AppUrlListener } from './AppUrlListener';
import { WalletContext, type WalletBridge } from './bridge';

const monad = defineChain({ ...MONAD_TESTNET, rpcUrls: { default: { http: [config.rpcUrl] } } });

function Bridge({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const { wallets } = useWallets();
  const email = useLoginWithEmail();
  const oauth = useLoginWithOAuth();
  const { sendTransaction } = useSendTransaction();
  const { signTypedData } = useSignTypedData();
  const embedded = wallets.find((w) => w.walletClientType === 'privy') ?? wallets[0];
  const bridge = useMemo<WalletBridge>(
    () => ({
      ready: privy.ready,
      authenticated: privy.authenticated,
      address: (embedded?.address as `0x${string}` | undefined) ?? null,
      loginGoogle: () => oauth.initOAuth({ provider: 'google' }),
      sendEmailCode: (addr) => email.sendCode({ email: addr }),
      loginWithCode: (code) => email.loginWithCode({ code }),
      getAccessToken: () => privy.getAccessToken(),
      async sendTx(tx) {
        // Sponsored via Privy's native gas sponsorship (EIP-7702), no confirmation modal.
        const { hash } = await sendTransaction(
          { to: tx.to, data: tx.data, chainId: config.chainId, ...(tx.gas ? { gasLimit: tx.gas } : {}) },
          { sponsor: true, uiOptions: { showWalletUIs: false }, address: embedded?.address },
        );
        return hash;
      },
      async signTypedData(params) {
        const { signature } = await signTypedData(params as never, { uiOptions: { showWalletUIs: false }, address: embedded?.address });
        return signature as `0x${string}`;
      },
      logout: () => privy.logout(),
    }),
    [privy, embedded, email, oauth, sendTransaction, signTypedData],
  );
  return <WalletContext.Provider value={bridge}>{children}</WalletContext.Provider>;
}

/**
 * Privy Google (Custom Tabs + App Links) and email OTP with a silent embedded wallet (§17.4).
 * Loaded only when VITE_PRIVY_APP_ID is set, in its own chunk.
 */
export default function PrivyRoot({ children }: { children: ReactNode }) {
  return (
    <>
      <AppUrlListener />
      <PrivyProvider
        appId={config.privyAppId}
        config={{
          loginMethods: ['google', 'email'],
          appearance: { theme: 'dark', accentColor: '#c9a24a' },
          embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' }, showWalletUIs: false },
          defaultChain: monad,
          supportedChains: [monad],
          customOAuthRedirectUrl: `https://${config.landingHost}/redirect`,
        }}
      >
        <Bridge>{children}</Bridge>
      </PrivyProvider>
    </>
  );
}
