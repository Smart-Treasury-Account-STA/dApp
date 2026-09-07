"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

import {
  connectWallet as connectWalletImpl,
  disconnectWallet as disconnectWalletImpl,
  getConnectedAddress,
} from "@/lib/wallet";
import type { WalletState } from "@/types";

/** Neither Freighter nor the wallets kit emits an event on account switch,
 * so this is the only way to notice one happened without a manual
 * disconnect/reconnect -- see getConnectedAddress's own doc comment. Short
 * enough that switching accounts in the extension feels responsive; long
 * enough not to matter for a call this cheap (a local RPC-free read from
 * the extension itself, not a network round trip). */
const WALLET_ADDRESS_POLL_MS = 2000;

const initialWallet: WalletState = {
  address: null,
  walletName: null,
  connected: false,
};

type WalletContextValue = {
  wallet: WalletState;
  connect: () => Promise<WalletState>;
  disconnect: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

/**
 * Wallet connection state, lifted out of `treasury-console.tsx` (where it
 * used to live as local `useState`, prop-drilled to every section) so a
 * route that runs *before* any treasury is selected -- the "My Treasuries" /
 * deploy-wizard route -- has somewhere to read/connect the wallet from too.
 * Deliberately does not own notice/toast state: different routes want
 * different notice UX around connect/disconnect, so that stays local to
 * each consumer.
 */
export function WalletProvider({ children }: { children: ReactNode }) {
  const [wallet, setWallet] = useState<WalletState>(initialWallet);

  const connect = useCallback(async () => {
    const connected = await connectWalletImpl();
    setWallet(connected);
    return connected;
  }, []);

  const disconnect = useCallback(() => {
    disconnectWalletImpl();
    setWallet(initialWallet);
  }, []);

  // Catches switching accounts in the Freighter extension itself, which
  // otherwise leaves every section reading a stale wallet.address until a
  // manual disconnect/reconnect (or a full page reload, which drops the
  // connection entirely rather than picking up the new account).
  useEffect(() => {
    if (!wallet.connected) return;

    const interval = setInterval(async () => {
      const current = await getConnectedAddress();
      if (current && current !== wallet.address) {
        setWallet((prev) => ({ ...prev, address: current }));
      }
    }, WALLET_ADDRESS_POLL_MS);

    return () => clearInterval(interval);
  }, [wallet.connected, wallet.address]);

  return (
    <WalletContext.Provider value={{ wallet, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextValue {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider.");
  }
  return context;
}
