"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { CircleWallet } from "./circle";
import { InjectedWallet } from "./injected";
import { SolanaWallet } from "./solana";
import type { WalletAdapter } from "./types";

export type WalletKind = "evm" | "solana" | "circle";

type WalletState = {
  adapter: WalletAdapter;
  /** Which wallet is in use: an EVM browser wallet, or a Solana wallet acting through its Arc account. */
  kind: WalletKind;
  setKind: (k: WalletKind) => void;
  solana: SolanaWallet;
  evm: WalletAdapter;
  circle: CircleWallet;
  account: Address | null;
  connecting: boolean;
  error: string | null;
  connect: () => Promise<Address | null>;
};

const WalletContext = createContext<WalletState | null>(null);

/** Swap the adapter here (or pass one in) to change how users sign. */
export function WalletProvider({ children, adapter }: { children: React.ReactNode; adapter?: WalletAdapter }) {
  const evm = useMemo(() => adapter ?? new InjectedWallet(), [adapter]);
  const solana = useMemo(() => new SolanaWallet(), []);
  const circle = useMemo(() => new CircleWallet(), []);
  const [kind, setKindState] = useState<WalletKind>("evm");
  // A Circle smart account signed in earlier in this browser comes back by itself.
  useEffect(() => {
    try {
      if (localStorage.getItem("honorcat.circle.credential") && CircleWallet.clientKey()) void Promise.resolve().then(() => setKindState("circle"));
    } catch {
      /* no storage */
    }
  }, []);
  const wallet: WalletAdapter = kind === "solana" ? solana : kind === "circle" ? circle : evm;
  const [account, setAccount] = useState<Address | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    wallet.getAccount().then(setAccount).catch(() => {});
    return wallet.onAccountChange(setAccount);
  }, [wallet]);

  const setKind = useCallback((k: WalletKind) => {
    setAccount(null);
    setError(null);
    setKindState(k);
  }, []);

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
    <WalletContext.Provider value={{ adapter: wallet, kind, setKind, solana, evm, circle, account, connecting, error, connect }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}
