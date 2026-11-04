import { createContext, useContext } from 'react';

/**
 * What the game needs from the auth/wallet provider (Privy). Absent (null) when no
 * VITE_PRIVY_APP_ID is configured — then guest sign-in and the relayer paths are used.
 */
export interface WalletBridge {
  ready: boolean;
  authenticated: boolean;
  address: `0x${string}` | null;
  loginGoogle(): Promise<void>;
  sendEmailCode(email: string): Promise<void>;
  loginWithCode(code: string): Promise<void>;
  getAccessToken(): Promise<string | null>;
  /** A sponsored transaction from the embedded wallet, with no wallet UI. Returns the tx hash. */
  sendTx(tx: { to: `0x${string}`; data: `0x${string}`; gas?: bigint }): Promise<`0x${string}`>;
  signTypedData(params: unknown): Promise<`0x${string}`>;
  logout(): Promise<void>;
}

export const WalletContext = createContext<WalletBridge | null>(null);
export const useWallet = () => useContext(WalletContext);
