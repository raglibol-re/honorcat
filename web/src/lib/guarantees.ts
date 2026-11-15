"use client";

import type { GuaranteeCardData } from "@/components/guarantee/GuaranteeCard";
import { RAIL_LABELS, type RailStep } from "@/components/guarantee/SettlementRail";

/** Client mirror of GET /api/guarantees/[id]. */
export type GuaranteeDetail = {
  guarantee: {
    id: string;
    gid: number | null;
    potId: number | null;
    template: "rate" | "temperature" | "price" | "demo";
    merchantName: string;
    merchant: string;
    eventTicker: string;
    contractTicker: string;
    side: "yes" | "no";
    eventTitle: string;
    contractLabel: string;
    promise: string;
    refund: string;
    maxCustomers: number;
    lockTime: number;
    settlesAt: number;
    deadline: number;
    conditionId: string;
    createdTx: string | null;
    status: string;
  };
  chain: { chainId: number; vault: string; book: string | null; resolver: string; usdc: string };
  events: { txHash: string; logIndex: number; block: number; time: number | null; name: string; contract: string; args: Record<string, unknown>; firstSeenVia: string }[];
  customers: {
    account: string;
    seat: number;
    enrolled: { tx: string; block: number; time: number | null };
    refund: { tx: string; block: number; time: number | null; deferred: boolean } | null;
  }[];
  memos: { txHash: string; logIndex: number; block: number; time: number | null; target: string; memoId: string; text: string | null; body: Record<string, unknown> | null }[];
  resolution: {
    action: string;
    outcome: boolean | null;
    tx: string | null;
    status: string;
    signature: string | null;
    digest: string | null;
    reason: string | null;
    signedPayload: unknown;
  } | null;
  relayTxs: { txHash: string; kind: string; latencyMs: number | null; feeWei: string | null; block: number | null }[];
  settlement: {
    resultSeenAt: number | null;
    resolvedTx: string;
    resolvedBlock: number;
    resolvedTime: number | null;
    refundTx: string | null;
    refundBlock: number | null;
    confirmedAt: number | null;
    resultToPaymentMs: number | null;
    broadcastToReceiptMs: number | null;
  } | null;
  onchain: {
    fromChain: true;
    block: string;
    potStatus: string;
    potOutcome: boolean;
    potTotal: string;
    enrolled: number | null;
    refundsSettled: boolean | null;
  } | null;
  market: { estimate: true; status: string | null; resolutionSide: string | null; chanceYes: number | null; chanceOfRefund: number | null } | null;
};

export type CardState = "active" | "refunded" | "not_triggered";

export function cardState(d: GuaranteeDetail): CardState {
  const s = d.onchain?.potStatus;
  if (s === "resolved") return d.onchain!.potOutcome ? "refunded" : "not_triggered";
  if (s === "expired") return "not_triggered";
  return "active";
}

/** The memo reason that explains the settlement, in plain words. */
export function settlementReason(d: GuaranteeDetail, state: CardState): string | undefined {
  const refunds = d.memos.find((m) => m.body?.t === "refunds")?.body?.why as string | undefined;
  const resolve = d.memos.find((m) => m.body?.t === "payout" || m.body?.t === "refund" || m.body?.t === "expire")?.body?.why as string | undefined;
  if (state === "refunded") return (resolve ?? refunds)?.concat(".");
  if (state === "not_triggered") return resolve ? `${resolve}. The promise was not triggered; the merchant's deposit went back to them.` : undefined;
  return undefined;
}

export function railFor(d: GuaranteeDetail, account: string | null): RailStep[] {
  const ev = (name: string, contract = "vault") => d.events.find((e) => e.name === name && e.contract === contract);
  const created = ev("PotCreated");
  const me = account ? d.customers.find((c) => c.account.toLowerCase() === account.toLowerCase()) : null;
  const enrolled = me?.enrolled ?? (account ? null : d.customers[0]?.enrolled ?? null);
  const settled = ev("PotResolved") ?? ev("PotExpired");
  const paid = me?.refund ?? (account ? null : d.customers.find((c) => c.refund)?.refund ?? null);
  const merchantBack = ev("Refund");
  const state = cardState(d);
  const chip = (e?: { txHash?: string; tx?: string; block: number; time: number | null } | null) =>
    e ? { tx: e.txHash ?? e.tx, block: e.block, time: e.time ?? undefined } : {};
  return [
    { key: "locked", label: RAIL_LABELS.locked, done: Boolean(created), ...chip(created) },
    { key: "enrolled", label: RAIL_LABELS.enrolled, done: Boolean(enrolled), ...chip(enrolled) },
    // The event happens off-chain (Gemini settles); the relay records when it saw the result.
    { key: "event", label: RAIL_LABELS.event, done: Boolean(settled) || d.market?.status === "settled" },
    { key: "settlement", label: RAIL_LABELS.settlement, done: Boolean(settled), ...chip(settled) },
    {
      key: "paid",
      label: state === "not_triggered" ? "Closed" : RAIL_LABELS.paid,
      done: state === "not_triggered" ? Boolean(merchantBack ?? settled) : Boolean(paid),
      ...chip(state === "not_triggered" ? (merchantBack ?? settled) : paid),
    },
  ];
}

export function toCard(d: GuaranteeDetail, account: string | null): GuaranteeCardData {
  const me = account ? d.customers.find((c) => c.account.toLowerCase() === account.toLowerCase()) : null;
  const state = cardState(d);
  return {
    merchant: d.guarantee.merchantName,
    promise: d.guarantee.promise,
    refundUsdc: d.guarantee.refund,
    chance: state === "active" ? (d.market?.chanceOfRefund ?? null) : null,
    settlesAt: new Date(d.guarantee.settlesAt * 1000).toISOString(),
    state,
    seat: { n: me?.seat ?? d.customers.length, of: d.guarantee.maxCustomers },
    account: me ? me.account : "", // empty for visitors: the card shows places taken instead
    lockedUsdc: d.onchain?.potTotal ?? "0",
    potId: d.guarantee.potId ?? 0,
    vault: d.chain.vault,
    steps: railFor(d, account),
    reason: settlementReason(d, state),
  };
}
