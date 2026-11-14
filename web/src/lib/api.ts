"use client";

import { useEffect, useRef, useState } from "react";
import type { Address } from "viem";

/** Client-side types mirroring @verdict/relay's DTOs (kept separate to avoid bundling server code). */
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
  kind: "payout" | "refund" | "payout_deferred" | "refund_deferred" | "claim";
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
          setData(await getJson<T>(path));
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stopped) timer.current = setTimeout(run, intervalMs);
    };
    run();
    return () => {
      stopped = true;
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
