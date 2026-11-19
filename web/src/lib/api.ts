"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";

/** Client-side types mirroring @honorcat/relay's DTOs (kept separate to avoid bundling server code). */
export type Pot = {
  potId: number;
  conditionId: string;
  creator: string;
  resolver: string;
  refundTo: string;
  deadline: number;
  payees: { address: string; shareBps: number }[];
  status: "open" | "resolved" | "expired";
  outcome: boolean | null;
  total: string;
  fundingCount: number;
  createdTx: string;
  createdTime: number | null;
  settledTx: string | null;
  settledTime: number | null;
  condition: { source: string; key: string; label: string | null } | null;
};

export type Payment = {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  time: number | null;
  potId: number | null;
  kind:
    | "payout"
    | "refund"
    | "payout_deferred"
    | "refund_deferred"
    | "claim"
    | "guarantee_refund"
    | "guarantee_deferred"
    | "guarantee_leftover"
    | "guarantee_claim";
  recipient: string;
  amount: string;
};

export type PotEvent = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  time: number | null;
  name: string;
  args: Record<string, unknown>;
};

export type PotDetail = {
  pot: Pot;
  events: PotEvent[];
  payments: Payment[];
  relay: { action: string; status: string; tx_hash: string | null; last_error: string | null } | null;
  relayCost?: { totalUsdc: string; txs: { txHash: string; kind: string; status: string; gasUsed: string | null; feeUsdc: string | null; latencyMs: number | null }[] };
};

export type Health = {
  chainId: number;
  vault: Address;
  resolver: Address | null;
  indexerPrimary: string;
  gasless?: { minAmount: string };
};

export async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  return body as T;
}

/** Polls a JSON endpoint while the component is mounted (and the tab is visible). */
/**
 * After the player acts, pages that poll check every second for a minute, so the result shows as
 * soon as it lands instead of at the next slow poll. Called by useAction and the perp page.
 */
let fastUntil = 0;
export function pollFast(ms = 60_000) {
  fastUntil = Date.now() + ms;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("hc:poll-fast"));
}

/** The delay before the next poll: `ms` normally, at most a second right after an action. */
export const pollDelay = (ms: number) => (Date.now() < fastUntil ? Math.min(ms, 1000) : ms);

export function usePolling<T>(path: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!path) return;
    let stopped = false;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const d = await getJson<T>(path);
          // A slower answer for the previous address must not overwrite this one's.
          if (stopped) return;
          setData(d);
          setError(null);
        } catch (err) {
          if (stopped) return;
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stopped) timer.current = setTimeout(run, Date.now() < fastUntil ? Math.min(intervalMs, 1000) : intervalMs);
    };
    // An action just happened: check again now, then every second for a while.
    const wake = () => {
      if (stopped) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(run, 300);
    };
    window.addEventListener("hc:poll-fast", wake);
    run();
    return () => {
      stopped = true;
      window.removeEventListener("hc:poll-fast", wake);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [path, intervalMs]);

  return { data, error };
}

let healthPromise: Promise<Health> | null = null;
export function getHealth(): Promise<Health> {
  healthPromise ??= getJson<Health>("/api/health").catch((e) => {
    healthPromise = null;
    throw e;
  });
  return healthPromise;
}
