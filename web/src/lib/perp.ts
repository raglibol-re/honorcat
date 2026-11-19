"use client";

/**
 * Perps (HonorCatPerps) in the browser: the rope a creator's choices give, the rules the contracts
 * check (so the form never offers a rope that would be refused), the plain summary, and every player
 * action for both kinds of account.
 *
 * A perp is a chain of short ropes on one market. Each rope has two posts, d either side of the
 * entry price; both players put in the same stake S = d (in ticks) × size. Past a post the rope ends
 * at once (one side loses its stake: one life); otherwise it ends after its rope life and is divided
 * at the price then. Each time, the next rope starts at the division price, as long as both players
 * have at least one stake left and nobody stopped renewing.
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { perpsAbi } from "@honorcat/relay/perpsAbi";
import { getJson } from "./api";
import {
  ensureFunds,
  passkeyCall,
  walletSend,
  type Actor,
  type PreparedRope,
  type Step,
} from "./hc";
import { P } from "./rope";

export * from "./perpMath";
import { FIRST_TOLERANCE } from "./perpMath";

/* ------------------------------------------------------------------ the chain's state, as served by /api/hc/perps */

export const PERP_PHASES = [
  "None",
  "Open",
  "Funded",
  "Joining",
  "Running",
  "Ended",
] as const;
export type PerpPhase = (typeof PERP_PHASES)[number];
export type PerpData = {
  t: {
    conditionId: Hex;
    resolver: Address;
    creatorSide: number;
    d: number;
    size: string;
    ropeLife: string;
    closeTime: string;
    grace: string;
    window: number;
    minSamples: number;
    tolerance: number;
  };
  a: Address;
  b: Address;
  phase: number;
  renewA: boolean;
  renewB: boolean;
  leaving: boolean;
  pot: string;
  freeA: string;
  freeB: string;
  resultA: string;
  resultB: string;
  ropes: number;
  treat: string;
  livesA: string;
  livesB: string;
  stake: string;
  potDb: string | null;
};
export type PerpEvent = {
  name: string;
  args: Record<string, string>;
  tx: string;
  at: number | null;
  pot: string | null;
};
export type PerpMarket = {
  instrument: string;
  eventTicker: string;
  contractTicker: string;
  eventTitle: string;
  label: string;
  /** The YES price (ppm) the leverages are shown at: the running rope's entry, else the market's last price. */
  center: number | null;
  /** Gemini's page slug (perp detail only). */
  slug?: string | null;
};

/** Both leverages (creator, joiner) at the perp's shown price, or null. */
export function perpLeverages(p: {
  data: Pick<PerpData, "t">;
  market: PerpMarket | null;
}) {
  const c = p.market?.center ?? null;
  if (c === null) return null;
  const q = p.data.t.creatorSide === 0 ? c : 1_000_000 - c;
  return { creator: q / p.data.t.d, joiner: (1_000_000 - q) / p.data.t.d };
}
export type PerpDetail = {
  perpId: string;
  phase: PerpPhase;
  a: string;
  b: string | null;
  pot: string | null;
  data: PerpData;
  market: PerpMarket | null;
  /** The practice cat plays the other side (test money). */
  practice?: boolean;
  events: PerpEvent[];
};
export type PerpSummary = Omit<PerpDetail, "events">;

/** One rope with its posts and the price window that decided it (/api/hc/perps/{id}/ropes). */
export type RopeStory = {
  rope: number;
  pot: string;
  lower: number;
  upper: number;
  armedAt: number;
  expiry: number;
  decided: {
    kind: "entry" | "exit" | "post" | "expiry";
    windowStart: number;
    windowEnd: number;
    priceYes: number | null;
    averages: { signer: string; priceYes: number; valid: boolean; samples: number }[];
    tx: string | null;
  } | null;
  unagreed: number;
  /** The samplers' 30-second prices for this rope: [window end (s), YES ppm]. */
  checks: [number, number][];
};
export const getPerpRopes = (id: string) =>
  getJson<{ ropes: RopeStory[] }>(`/api/hc/perps/${id}/ropes`);
export const getCandles = (symbol: string, since: number) =>
  getJson<{ candles: [number, number][] }>(
    `/api/catalog/candles?symbol=${encodeURIComponent(symbol)}&since=${since}`,
  );

export const getPerp = (id: string) =>
  getJson<PerpDetail>(`/api/hc/perps/${id}`);
export const listPerps = (
  q: { owner?: string; state?: "open" | "running" } = {},
) =>
  getJson<{ perps: PerpSummary[] }>(
    `/api/hc/perps?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`,
  );
const resync = (id: string) =>
  getJson(`/api/hc/perps/${id}`, { method: "POST" }).catch(() => null);

/** Which player `who` is: "a" (creator), "b" (joiner) or null. */
export function playerOf(
  p: Pick<PerpDetail, "a" | "b">,
  who: string | null | undefined,
): "a" | "b" | null {
  if (!who) return null;
  if (p.a.toLowerCase() === who.toLowerCase()) return "a";
  if (p.b && p.b.toLowerCase() === who.toLowerCase()) return "b";
  return null;
}

/** Both leverages of a perp, creator first. */
export function leveragesOf(d: PerpData, yesAtStart?: number | null) {
  // The creator's leverage depends on the price at each rope's start; the terms fix d. Shown at the
  // price the perp was offered (or the current one when known).
  const q = yesAtStart ?? null;
  if (q === null) return null;
  const qSide = d.t.creatorSide === 0 ? q : P - q;
  return { creator: qSide / d.t.d, joiner: (P - qSide) / d.t.d };
}

/* ------------------------------------------------------------------ actions */

async function perpCall(
  actor: Actor,
  perps: Address,
  data: Hex,
  spend: bigint,
  perpId: string | null,
  onStep?: Step,
) {
  if (spend > 0n) await ensureFunds(actor.account, spend, onStep);
  if (actor.kind === "passkey") {
    const r = (await passkeyCall(
      actor.session,
      actor.account,
      data,
      spend,
      onStep,
      perps,
    )) as { tx: Hex; perpId?: string | null };
    const id = r.perpId ?? perpId;
    if (id) await resync(id);
    return { tx: r.tx, perpId: id ?? null };
  }
  const r = await walletSend(
    actor.adapter,
    actor.account,
    perps,
    data,
    null,
    spend,
    onStep,
  );
  let id = perpId;
  if (!id) {
    // The new perp's id, from its PerpOpened event.
    const { publicClient } = await import("./chain");
    const { parseEventLogs } = await import("viem");
    const receipt = await publicClient
      .waitForTransactionReceipt({ hash: r.tx, timeout: 60_000 })
      .catch(() => null);
    const ev = receipt
      ? parseEventLogs({
          abi: perpsAbi,
          logs: receipt.logs,
          eventName: "PerpOpened",
        })[0]
      : undefined;
    id = ev ? (ev.args as { perpId: bigint }).perpId.toString() : null;
  }
  if (id) await resync(id);
  return { tx: r.tx, perpId: id };
}

/** Opens a perp: the creator's terms and budget (lives × stake). */
export async function openPerp(
  actor: Actor,
  perps: Address,
  prep: PreparedRope,
  o: {
    side: 0 | 1;
    d: number;
    size: bigint;
    ropeLifeS: number;
    graceDays: number;
    budget: bigint;
  },
  onStep?: Step,
) {
  const terms = {
    conditionId: prep.conditionId,
    resolver: prep.resolver,
    creatorSide: o.side,
    d: o.d,
    size: o.size,
    ropeLife: BigInt(o.ropeLifeS),
    closeTime: BigInt(prep.closeTime),
    grace: BigInt(Math.round(o.graceDays * 86_400)),
    window: prep.window,
    minSamples: prep.minSamples,
    tolerance: FIRST_TOLERANCE,
  };
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "open",
    args: [terms, o.budget],
  });
  return perpCall(actor, perps, data, o.budget, null, onStep);
}

/** Joins as the other side with `budget` (lives × stake, plus the maker treat for the first rope). */
export async function joinPerp(
  actor: Actor,
  perps: Address,
  perpId: string,
  budget: bigint,
  onStep?: Step,
) {
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "join",
    args: [BigInt(perpId), budget],
  });
  return perpCall(actor, perps, data, budget, perpId, onStep);
}

export async function addLives(
  actor: Actor,
  perps: Address,
  perpId: string,
  amount: bigint,
  onStep?: Step,
) {
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "addLives",
    args: [BigInt(perpId), amount],
  });
  return perpCall(actor, perps, data, amount, perpId, onStep);
}

export async function withdrawSpare(
  actor: Actor,
  perps: Address,
  perpId: string,
  amount: bigint,
  onStep?: Step,
) {
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "withdraw",
    args: [BigInt(perpId), amount],
  });
  return perpCall(actor, perps, data, 0n, perpId, onStep);
}

export async function stopRenewing(
  actor: Actor,
  perps: Address,
  perpId: string,
  onStep?: Step,
) {
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "stopRenewing",
    args: [BigInt(perpId)],
  });
  return perpCall(actor, perps, data, 0n, perpId, onStep);
}

export async function leaveNow(
  actor: Actor,
  perps: Address,
  perpId: string,
  onStep?: Step,
) {
  const data = encodeFunctionData({
    abi: perpsAbi,
    functionName: "leaveNow",
    args: [BigInt(perpId)],
  });
  return perpCall(actor, perps, data, 0n, perpId, onStep);
}
