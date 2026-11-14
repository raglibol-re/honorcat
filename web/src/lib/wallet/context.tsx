"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { InjectedWallet } from "./injected";
import type { WalletAdapter } from "./types";

type WalletState = {
  adapter: WalletAdapter;
  account: Address | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<Address | null>;
};

const WalletContext = createContext<WalletState | null>(null);

/** Swap the adapter here (or pass one in) to change how users sign. */
export function WalletProvider({ children, adapter }: { children: React.ReactNode; adapter?: WalletAdapter }) {
  const wallet = useMemo(() => adapter ?? new InjectedWallet(), [adapter]);
  const [account, setAccount] = useState<Address | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wallet.getAccount().then(setAccount).catch(() => {});
    return wallet.onAccountChange(setAccount);
  }, [wallet]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const a = await wallet.connect();
      setAccount(a);
      return a;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    } finally {
      setConnecting(false);
    }
  }, [wallet]);

  return (
    <WalletContext.Provider value={{ adapter: wallet, account, connecting, error, connect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
