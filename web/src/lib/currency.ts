import { formatAmount } from "./amount";
/**
 * The player's home currency for showing amounts: USDC (dollars, the default) or EURC (euros, at a
 * stated rate from Circle Swap Kit). Display only: pots hold and pay test USDC either way.
 * `money()` is pure so pure helpers (receipts, scene) can use it; views call `useHome()` so they
 * re-render when the choice or the rate changes.
 */
import { useSyncExternalStore } from "react";

export type Home = "USDC" | "EURC";
export type EurRate = { eurcPerUsdc: number; usdcUsd: number; eurcUsd: number; fetchedAt: number; source: string };

const KEY = "honorcat.home";
let state: { home: Home; rate: EurRate | null } = { home: "USDC", rate: null };
const listeners = new Set<() => void>();
let started = false;
let loading: Promise<void> | null = null;

function emit(next: Partial<typeof state>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function loadRate() {
  if (loading) return loading;
  loading = fetch("/api/hc/rate")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { rate: EurRate | null } | null) => {
      if (j?.rate) emit({ rate: j.rate });
    })
    .catch(() => undefined)
    .finally(() => {
      // Refresh at most every 10 minutes.
      setTimeout(() => (loading = null), 10 * 60_000);
    });
  return loading;
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  let home: Home = "USDC";
  try {
    if (localStorage.getItem(KEY) === "EURC") home = "EURC";
  } catch {
    /* private mode: dollars */
  }
  if (home === "EURC") {
    emit({ home });
    void loadRate();
  }
}

export function setHome(home: Home) {
  try {
    localStorage.setItem(KEY, home);
  } catch {
    /* not remembered in private mode */
  }
  emit({ home });
  if (home === "EURC") void loadRate();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  start();
  return () => listeners.delete(l);
};
const SERVER = { home: "USDC" as Home, rate: null };

/** The home currency and the rate, re-rendering the caller when either changes. */
export function useHome() {
  return useSyncExternalStore(subscribe, () => state, () => SERVER);
}

/** True when amounts are being shown in euros (EURC chosen and a rate known). */
export const inEuros = () => state.home === "EURC" && !!state.rate;

/**
 * An amount in USDC base units, in the home currency: "$7.40", "$0.675", "$7.405", "under 0.1¢", or
 * "€6.73" at the stated rate (lib/amount.ts has the rule).
 */
export function money(base: string | number | bigint): string {
  const usd = Number(base) / 1e6;
  const eur = state.home === "EURC" && state.rate;
  return formatAmount(eur ? usd * state.rate!.eurcPerUsdc : usd, eur ? "€" : "$");
}

/**
 * An exact amount with up to four decimals ("$0.9997"), in the home currency: for the few places
 * that must show a value finer than a tenth of a cent (a perp's stake per life).
 */
export function moneyExact(base: string | number | bigint): string {
  const usd = Number(base) / 1e6;
  const eur = state.home === "EURC" && state.rate;
  const v = eur ? usd * state.rate!.eurcPerUsdc : usd;
  const t = Math.abs(v).toFixed(4).replace(/(\.\d\d\d?)0+$/, "$1");
  return `${v < 0 ? "-" : ""}${eur ? "€" : "$"}${t}`;
}

/** Same as money() (kept for callers that asked for three decimals under one). */
export const money3 = money;

/** The rate as a plain sentence part: "1 USDC = 0.909 EURC". */
export const rateText = (r: EurRate) => `1 USDC = ${r.eurcPerUsdc.toFixed(3)} EURC`;
