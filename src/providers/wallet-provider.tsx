"use client";

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";

import { connectWallet as connectWalletImpl, disconnectWallet as disconnectWalletImpl } from "@/lib/wallet";
import type { WalletState } from "@/types";

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
