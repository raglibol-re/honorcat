"use client";

import { useSyncExternalStore } from "react";
import type { EIP1193Provider } from "viem";

/**
 * EIP-6963: every installed wallet announces itself (name, icon, id) instead of racing for
 * `window.ethereum`. The user picks one, and every request goes to exactly that wallet.
 */
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
export type AnnouncedWallet = { info: WalletInfo; provider: EIP1193Provider };

const wallets = new Map<string, AnnouncedWallet>();
const listeners = new Set<() => void>();
let snapshot: AnnouncedWallet[] = [];
let started = false;
let chosen: string | null = null;

const KEY = "honorcat.wallet.rdns";

function emit() {
  snapshot = [...wallets.values()].sort((a, b) => a.info.name.localeCompare(b.info.name));
  listeners.forEach((l) => l());
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("eip6963:announceProvider", ((e: CustomEvent<AnnouncedWallet>) => {
    const w = e.detail;
    if (!w?.info?.uuid || !w.provider) return;
    // Icons must be data URIs (the standard); anything else is not shown.
    const icon = typeof w.info.icon === "string" && w.info.icon.startsWith("data:image/") ? w.info.icon : "";
    wallets.set(w.info.rdns || w.info.uuid, { info: { ...w.info, icon }, provider: w.provider });
    emit();
  }) as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  try {
    chosen = localStorage.getItem(KEY);
  } catch {
    chosen = null;
  }
}

const NO_WALLETS: AnnouncedWallet[] = [];

/** The wallets this browser announced (empty on the server and before they answer). */
export function useAnnouncedWallets(): AnnouncedWallet[] {
  return useSyncExternalStore(
    (cb) => {
      start();
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => NO_WALLETS,
  );
}

/** Remembers the wallet the user picked (by its reverse-DNS id, e.g. io.metamask). */
export function chooseWallet(rdns: string) {
  start();
  chosen = rdns;
  try {
    localStorage.setItem(KEY, rdns);
  } catch {
    /* this tab only */
  }
}

/** The picked wallet's provider; else the only announced one; else the legacy window.ethereum. */
export function chosenProvider(): { provider: EIP1193Provider; name: string } | null {
  start();
  if (chosen && wallets.has(chosen)) {
    const w = wallets.get(chosen)!;
    return { provider: w.provider, name: w.info.name };
  }
  if (wallets.size === 1) {
    const w = [...wallets.values()][0]!;
    return { provider: w.provider, name: w.info.name };
  }
  if (typeof window !== "undefined" && window.ethereum) return { provider: window.ethereum, name: "Browser wallet" };
  return null;
}
