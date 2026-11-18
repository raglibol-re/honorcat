"use client";

import { encodeAbiParameters, encodeFunctionData, parseEventLogs, type Address, type Hex } from "viem";
import { potsAbi } from "@honorcat/relay/potsAbi";
import { ropesAbi } from "@honorcat/relay/ropesAbi";
import { getJson } from "./api";
import { publicClient, USDC_ADDRESS } from "./chain";
import { signChallenge, type PasskeySession } from "./passkey";
import type { WalletAdapter } from "./wallet/types";

/**
 * Two-sided pots in the browser: types mirroring /api/hc, the share arithmetic of the contract,
 * and every user action for both kinds of account:
 * - passkey accounts sign `execute` challenges; HonorCat pays the fee;
 * - browser wallets send ordinary transactions, like any serious web3 app: an exact-amount USDC
 *   approval for HonorCatPots when the allowance is short, then the deposit or action itself. The
 *   wallet shows exactly what moves; nothing is pulled by an off-chain signature. Arc's fee is a
 *   fraction of a cent, paid in USDC.
 */
export const P = 1_000_000;
export const STATES = ["None", "Open", "Joining", "Live", "ExitRequested", "Divided", "Settled", "Expired"] as const;
export type PotStateName = (typeof STATES)[number];
export const YES = 0;
export const NO = 1;

export type PotData = {
  conditionId: Hex;
  resolver: Address;
  notional: string;
  depYes: string;
  depNo: string;
  escrowYes: string;
  escrowNo: string;
  bandCenter: string;
  tolerance: string;
  window: string;
  minSamples: string;
  feeBps: string;
  creatorSide: string;
  state: string;
  closeTime: string;
  deadline: string;
  cooldownUntil: string;
  nonce: string;
  joiner: Address;
  exitSide: string;
  requestTime: string;
  exitNotional: string;
  levels?: ({ net: number; bowl: number; setAt: string } | null)[];
};
export type WindowAttestation = { potId: string; kind: number; nonce: string; windowStart: string; windowEnd: string; sampleCount: number; priceYes: number; valid: boolean; evidenceHash: Hex };
export type AttRequest = {
  id: string;
  kind: "window" | "depth" | "outcome";
  status: "measuring" | "proposed" | "ready" | "submitted" | "failed";
  tx: string | null;
  error: string | null;
  createdAt: string;
  payload: {
    kind?: number;
    windowStart?: number;
    windowEnd?: number;
    attestation?: WindowAttestation;
    reason?: string;
    averages?: { signer: Address; ppm: string; valid: boolean; sampleCount: number; evidenceHash: Hex }[];
    /** The reason as recorded on Arc (the payout transaction's Memo, decoded from the chain). */
    memo?: string;
  };
};
export type PotMarket = {
  conditionId: Hex;
  instrument: string;
  eventTicker: string;
  contractTicker: string;
  eventTitle: string;
  label: string;
  league?: string | null;
  teams?: string | null;
  startMs?: number | null;
  yesMeans?: string | null;
  closeMs?: number | null;
  slug?: string | null;
};
export type PotEvent = { name: string; args: Record<string, string>; tx: string; at: number | null };
export type HcPot = {
  potId: string;
  state: PotStateName;
  data: PotData;
  owners: { yes: Address | null; no: Address | null };
  createdTx: string | null;
  updatedAt: string;
  market: PotMarket | null;
  requests: AttRequest[];
  events?: PotEvent[];
  practice?: boolean;
  /** The network fee of each of this pot's transactions, in USDC base units. */
  fees?: Record<string, string>;
};
export type HcPotSummary = Omit<HcPot, "requests" | "createdTx" | "market"> & {
  market: { eventTitle: string; label: string; instrument: string; eventTicker: string; league?: string | null; teams?: string | null; startMs?: number | null; yesMeans?: string | null; closeMs?: number | null } | null;
};

export type Prepared = {
  conditionId: Hex;
  resolver: Address;
  pots: Address;
  chainId: number;
  closeTime: number;
  window: number;
  minSamples: number;
  depthId: string;
  depth: { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string };
  cap: string;
  midPpm: number | null;
  market: { symbol: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string; category: string; closeMs: number };
};

/* ------------------------------------------------------------------ the contract's arithmetic */

export const yesPart = (n: bigint, p: number) => (n * BigInt(p)) / BigInt(P);
export const noPart = (n: bigint, p: number) => n - yesPart(n, p);
export function worstCase(side: number, n: bigint, center: number, tol: number) {
  return side === YES ? yesPart(n, Math.min(center + tol, P)) : noPart(n, Math.max(center - tol, 0));
}
export const feeOf = (n: bigint, feeBps: number) => (n * BigInt(feeBps) + 9_999n) / 10_000n;
export const MAX_TOLERANCE = 50_000;
export const KIND = { join: 0, exit: 1, netYes: 2, netNo: 3, bowlYes: 4, bowlNo: 5 } as const;

export const pct = (ppm: number, digits = 1) => `${(ppm / 10_000).toFixed(digits)}%`;
export const usd = (base: bigint | string | number) => {
  const v = Number(base) / 1e6;
  return `$${v.toFixed(2)}`;
};

/** The side an address holds in a pot (or the pending joiner's side), if any. */
export function sideOf(p: Pick<HcPot, "owners" | "data">, a: string | null | undefined): number | null {
  if (!a) return null;
  const x = a.toLowerCase();
  if (p.owners.yes?.toLowerCase() === x) return YES;
  if (p.owners.no?.toLowerCase() === x) return NO;
  return null;
}

/* ------------------------------------------------------------------ who acts */

export type Actor = { kind: "passkey"; session: PasskeySession; account: Address } | { kind: "wallet"; adapter: WalletAdapter; account: Address };

const potsDomain = (pots: Address) => ({ name: "HonorCatPots", version: "1", chainId: 5042002, verifyingContract: pots }) as const;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const noAuth = (from: Address) => ({ from, validAfter: 0n, validBefore: 0n, salt: ZERO32, v: 0, r: ZERO32, s: ZERO32 });

/** Runs a pot call from a passkey account: one passkey prompt per step (an approval may come first). */
async function passkeyCall(session: PasskeySession, account: Address, data: Hex, spend: bigint, onStep?: (s: string) => void, target?: Address) {
  const prep = await getJson<{ steps: { target: Address; data: Hex; deadline: string; nonce: string; challenge: Hex; label: string }[] }>("/api/hc/passkey/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, data, spend: spend.toString(), ...(target ? { target } : {}) }),
  });
  const signed = [];
  for (const [i, s] of prep.steps.entries()) {
    onStep?.(prep.steps.length > 1 ? `Confirm with your passkey (${i + 1} of ${prep.steps.length}): ${s.label}` : "Confirm with your passkey");
    signed.push({ target: s.target, data: s.data, deadline: s.deadline, nonce: s.nonce, assertion: await signChallenge(session, s.challenge) });
  }
  onStep?.("Sending");
  return getJson<{ tx: Hex; potId: string | null }>("/api/hc/passkey/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, steps: signed }) });
}


const approveAbi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ type: "address" }, { type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

/**
 * A wallet transaction to the pot contract, preceded (only when the allowance is short) by an
 * approval of exactly `spend` USDC for it. Waits for the receipt, re-reads the pot so the samplers
 * start measuring at once, and returns the pot id from the contract's own event.
 */
async function walletSend(adapter: WalletAdapter, account: Address, pots: Address, data: Hex, potId: string | null, spend = 0n, onStep?: Step) {
  if (adapter.sendBatch) {
    // A smart account: the approval (when short) and the action in one user operation, gas sponsored.
    const calls: { to: Address; data: Hex }[] = [];
    if (spend > 0n) {
      const allowance = (await publicClient.readContract({ address: USDC_ADDRESS, abi: approveAbi, functionName: "allowance", args: [account, pots] })) as bigint;
      if (allowance < spend) calls.push({ to: USDC_ADDRESS, data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [pots, spend] }) });
    }
    calls.push({ to: pots, data });
    onStep?.("Confirm with your passkey (Circle pays the network fee)");
    const tx = await adapter.sendBatch(calls);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
    let id = potId;
    if (!id && receipt) {
      const created = parseEventLogs({ abi: potsAbi, logs: receipt.logs, eventName: "PotCreated" })[0];
      if (created) id = (created.args as { potId: bigint }).potId.toString();
    }
    if (id) await getJson(`/api/hc/pots/${id}`, { method: "POST" }).catch(() => null);
    return { tx, potId: id };
  }
  if (spend > 0n) {
    const allowance = (await publicClient.readContract({ address: USDC_ADDRESS, abi: approveAbi, functionName: "allowance", args: [account, pots] })) as bigint;
    if (allowance < spend) {
      onStep?.(`Approve ${(Number(spend) / 1e6).toFixed(2)} USDC for the HonorCat pot contract in your wallet`);
      const ap = await adapter.send({ to: USDC_ADDRESS, data: encodeFunctionData({ abi: approveAbi, functionName: "approve", args: [pots, spend] }) });
      await publicClient.waitForTransactionReceipt({ hash: ap, timeout: 60_000 });
    }
  }
  onStep?.("Confirm the transaction in your wallet (a network fee of a fraction of a cent, in USDC)");
  const tx = await adapter.send({ to: pots, data });
  onStep?.("Waiting for Arc to confirm");
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
  if (receipt && receipt.status !== "success") throw new Error("The transaction failed on Arc. Nothing was taken except the network fee.");
  let id = potId;
  if (!id && receipt) {
    const created = parseEventLogs({ abi: potsAbi, logs: receipt.logs, eventName: "PotCreated" })[0];
    if (created) id = (created.args as { potId: bigint }).potId.toString();
  }
  if (id) await getJson(`/api/hc/pots/${id}`, { method: "POST" }).catch(() => null);
  return { tx, potId: id };
}

export type Step = (s: string) => void;

/**
 * Makes sure the account can pay `need` before a deposit: HonorCat's test-money pool sends the
 * shortfall (testnet). Silent when the account already has enough.
 */
export async function ensureFunds(account: Address, need: bigint, onStep?: Step) {
  const bal = (await publicClient.readContract({ address: USDC_ADDRESS, abi: approveAbi2, functionName: "balanceOf", args: [account] })) as bigint;
  if (bal >= need + 100_000n) return;
  onStep?.("Adding test money to your account");
  const r = await getJson<{ sent: boolean; reason?: string }>("/api/hc/topup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, need: need.toString() }) });
  if (!r.sent && r.reason !== "enough already") throw new Error(`Could not add test money: ${r.reason}`);
}
const approveAbi2 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;

/* ------------------------------------------------------------------ actions */

export async function prepare(symbol: string, account: Address) {
  return getJson<Prepared>("/api/hc/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, account }) });
}

export async function waitDepth(id: string, onStep?: Step) {
  for (let i = 0; i < 40; i++) {
    const r = await getJson<{ signatures: Hex | null }>(`/api/hc/depth?id=${encodeURIComponent(id)}`);
    if (r.signatures) return r.signatures;
    onStep?.("Waiting for the samplers to confirm the market's depth");
    await new Promise((res) => setTimeout(res, 1500));
  }
  throw new Error("The samplers did not confirm the depth in time. Try again in a minute.");
}

export async function createPot(actor: Actor, prep: Prepared, o: { side: number; notional: bigint; bandCenter: number; tolerance: number; graceDays: number }, onStep?: Step) {
  const sigs = await waitDepth(prep.depthId, onStep);
  const c = {
    conditionId: prep.conditionId,
    resolver: prep.resolver,
    side: o.side,
    notional: o.notional,
    bandCenter: o.bandCenter,
    tolerance: o.tolerance,
    closeTime: BigInt(prep.closeTime),
    grace: BigInt(Math.round(o.graceDays * 86_400)),
    window: prep.window,
    minSamples: prep.minSamples,
  };
  const d = prep.depth;
  const depth = { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) };
  const escrow = worstCase(o.side, o.notional, o.bandCenter, o.tolerance);
  await ensureFunds(actor.account, escrow, onStep);
  if (actor.kind === "passkey") {
    const data = encodeFunctionData({ abi: potsAbi, functionName: "create", args: [c, depth, sigs, noAuth(actor.account)] });
    return passkeyCall(actor.session, actor.account, data, escrow, onStep);
  }
  return walletSend(actor.adapter, actor.account, prep.pots, encodeFunctionData({ abi: potsAbi, functionName: "create", args: [c, depth, sigs, noAuth(actor.account)] }), null, escrow, onStep);
}

export async function joinPot(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const side = 1 - Number(p.data.creatorSide);
  const escrow = worstCase(side, BigInt(p.data.notional), Number(p.data.bandCenter), Number(p.data.tolerance));
  const potId = BigInt(p.potId);
  await ensureFunds(actor.account, escrow, onStep);
  if (actor.kind === "passkey") {
    const data = encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [potId, noAuth(actor.account)] });
    return passkeyCall(actor.session, actor.account, data, escrow, onStep);
  }
  return walletSend(actor.adapter, actor.account, pots, encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [potId, noAuth(actor.account)] }), p.potId, escrow, onStep);
}

export async function requestExit(actor: Actor, pots: Address, p: HcPot, side: number, notional: bigint, onStep?: Step) {
  const potId = BigInt(p.potId);
  if (actor.kind === "passkey") {
    return passkeyCall(actor.session, actor.account, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [potId, side, notional] }), 0n, onStep);
  }
  return walletSend(actor.adapter, actor.account, pots, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [potId, side, notional] }), p.potId, 0n, onStep);
}

export async function setLevels(actor: Actor, pots: Address, p: HcPot, side: number, net: number, bowl: number, onStep?: Step) {
  const data = encodeFunctionData({ abi: potsAbi, functionName: "setLevels", args: [BigInt(p.potId), side, net, bowl] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep);
  return walletSend(actor.adapter, actor.account, pots, data, p.potId, 0n, onStep);
}

export async function takeover(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const potId = BigInt(p.potId);
  const n = BigInt(p.data.notional);
  await ensureFunds(actor.account, n, onStep);
  if (actor.kind === "passkey") {
    return passkeyCall(actor.session, actor.account, encodeFunctionData({ abi: potsAbi, functionName: "takeover", args: [potId, noAuth(actor.account)] }), n, onStep);
  }
  return walletSend(actor.adapter, actor.account, pots, encodeFunctionData({ abi: potsAbi, functionName: "takeover", args: [potId, noAuth(actor.account)] }), p.potId, n, onStep);
}

export async function cancelPot(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const data = encodeFunctionData({ abi: potsAbi, functionName: "cancel", args: [BigInt(p.potId)] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep);
  return walletSend(actor.adapter, actor.account, pots, data, p.potId, 0n, onStep);
}

/* ------------------------------------------------------------------ handshake signatures */

export const handshakeTypes = {
  Handshake: [
    { name: "potId", type: "uint256" },
    { name: "priceYes", type: "uint32" },
    { name: "notional", type: "uint256" },
    { name: "potNonce", type: "uint64" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** One owner's handshake signature: EIP-712 from a wallet, or a WebAuthn assertion (ERC-1271) from a passkey account. */
export async function signHandshake(actor: Actor, pots: Address, p: HcPot, priceYes: number, notional: bigint, deadline: bigint, onStep?: Step): Promise<Hex> {
  const message = { potId: BigInt(p.potId), priceYes, notional, potNonce: BigInt(p.data.nonce), deadline };
  if (actor.kind === "wallet") {
    onStep?.("Sign the handshake in your wallet (no fee)");
    return actor.adapter.signTypedData({ domain: potsDomain(pots), types: handshakeTypes, primaryType: "Handshake", message });
  }
  const digest = (await publicClient.readContract({ address: pots, abi: potsAbi, functionName: "handshakeDigest", args: [BigInt(p.potId), priceYes, notional, deadline] })) as Hex;
  onStep?.("Confirm the handshake with your passkey");
  const a = await signChallenge(actor.session, digest);
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "string" }],
    [a.r, a.s, BigInt(a.challengeIndex), BigInt(a.typeIndex), a.authenticatorData, a.clientDataJSON],
  );
}

export { potsAbi };


/* ------------------------------------------------------------------ HonorCat v2: short ropes */

/** v2 pots live at their deployment's id base (v2.0: 1e9, v2.1: 2e9) + their on-chain id in the read model and links. */
export const ROPE_BASE = 1_000_000_000n;
export const isRopePot = (potId: string | bigint) => BigInt(potId) >= ROPE_BASE;
/** The on-chain id of a v2 pot: its id within its deployment's range. */
export const ropeChainId = (potId: string | bigint) => BigInt(potId) % ROPE_BASE;

export type RopesStatus = {
  available: boolean;
  forNewPots: boolean;
  address: Address | null;
  rules: { expiryLeadS: number; maxLifeS: number; minLifeS: number; minDistancePpm: number; maxLeverageCrypto: number; maxLeverageOther: number; maxLives: number };
  fees: { operatorBps: number; exitFeeBps: number; makerTreatBps: number; referralShareBps: number; referralPots: number; copycatBps: number };
};
export const ropesStatus = () => getJson<RopesStatus>("/api/hc/ropes");

export type PreparedRope = Omit<Prepared, "cap" | "depth"> & {
  v2: true;
  /** The database id base of this deployment's pots. */
  idBase: string;
  depth: Prepared["depth"] & { spread: number; crypto: boolean };
  maxSize: string;
  maxPot: string;
  spread: number;
  crypto: boolean;
};

export async function prepareRope(symbol: string, account: Address) {
  return getJson<PreparedRope>("/api/hc/prepare-rope", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, account }) });
}

/** The pot id (read-model range) from a v2 transaction's PotCreated event. */
async function ropeIdFrom(tx: Hex, base: bigint) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
  const created = receipt ? parseEventLogs({ abi: ropesAbi, logs: receipt.logs, eventName: "PotCreated" })[0] : undefined;
  return created ? (base + (created.args as { potId: bigint }).potId).toString() : null;
}

/**
 * Offers a v2 pot: a short rope when `distYes` or `distNo` is set (with an expiry), a normal pot
 * otherwise. The creator's escrow is exactly its distance per contract on a rope side.
 */
export async function createRope(
  actor: Actor,
  prep: PreparedRope,
  o: { side: number; size: bigint; bandCenter: number; tolerance: number; distYes: number; distNo: number; expiry: number; graceDays: number; copyOf?: bigint; escrow: bigint },
  onStep?: Step,
) {
  const sigs = await waitDepth(prep.depthId, onStep);
  const c = {
    conditionId: prep.conditionId,
    resolver: prep.resolver,
    side: o.side,
    size: o.size,
    bandCenter: o.bandCenter,
    tolerance: o.tolerance,
    distYes: o.distYes,
    distNo: o.distNo,
    expiry: BigInt(o.expiry),
    closeTime: BigInt(prep.closeTime),
    grace: BigInt(Math.round(o.graceDays * 86_400)),
    window: prep.window,
    minSamples: prep.minSamples,
    copyOf: o.copyOf ?? 0n,
  };
  const d = prep.depth;
  const depth = { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), spread: d.spread, crypto: d.crypto, closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) };
  await ensureFunds(actor.account, o.escrow, onStep);
  await maybeSetReferrer(actor, prep.pots, onStep).catch(() => {}); // a referral never blocks a pot
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "create", args: [c, depth, sigs, noAuth(actor.account)] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, o.escrow, onStep, prep.pots);
  const r = await walletSend(actor.adapter, actor.account, prep.pots, data, null, o.escrow, onStep);
  const potId = await ropeIdFrom(r.tx, BigInt(prep.idBase));
  if (potId) await getJson(`/api/hc/pots/${potId}`, { method: "POST" }).catch(() => null);
  return { tx: r.tx, potId };
}

/** An extra life: moves the side's own post one rope length further out, paid by the side. */
export async function addLife(actor: Actor, ropes: Address, potId: string, side: number, cost: bigint, onStep?: Step) {
  const id = ropeChainId(potId);
  await ensureFunds(actor.account, cost, onStep);
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "addLife", args: [id, side, noAuth(actor.account)] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, cost, onStep, ropes);
  return walletSend(actor.adapter, actor.account, ropes, data, potId, cost, onStep);
}

/** The most the joining side can owe in the band (its distance on a rope side), plus the maker treat. */
export function ropeJoinEscrow(p: HcPot) {
  const d = p.data as unknown as Record<string, string>;
  const side = 1 - Number(d.creatorSide);
  const size = BigInt(d.size);
  const c = Number(d.bandCenter);
  const t = Number(d.tolerance);
  const dist = Number(side === YES ? d.distYes : d.distNo);
  let per: number;
  if (dist > 0) per = Math.floor(dist / 100);
  else if (side === YES) per = Math.floor(Math.min(P, c + t) / 100);
  else per = 10_000 - Math.floor(Math.max(0, c - t) / 100);
  const dep = BigInt(per) * size;
  return { deposit: dep, treat: (dep * 25n) / 10_000n, total: dep + (dep * 25n) / 10_000n };
}

/** Joins a v2 pot as the other side; `copyOf` (a token id) marks the new side as a copy of that player. */
export async function joinRope(actor: Actor, ropes: Address, p: HcPot, copyOf: bigint, onStep?: Step) {
  const id = ropeChainId(p.potId);
  const { total } = ropeJoinEscrow(p);
  await ensureFunds(actor.account, total, onStep);
  await maybeSetReferrer(actor, ropes, onStep).catch(() => {});
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "requestJoin", args: [id, copyOf, noAuth(actor.account)] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, total, onStep, ropes);
  return walletSend(actor.adapter, actor.account, ropes, data, p.potId, total, onStep);
}

/** Leaves a v2 pot (all or part of `size` hundredths), priced over the next window like every exit. */
export async function exitRope(actor: Actor, ropes: Address, p: HcPot, side: number, size: bigint, onStep?: Step) {
  const id = ropeChainId(p.potId);
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "requestExit", args: [id, side, size] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep, ropes);
  return walletSend(actor.adapter, actor.account, ropes, data, p.potId, 0n, onStep);
}

/** Takes back an offer nobody has joined (v2). */
export async function cancelRope(actor: Actor, ropes: Address, p: HcPot, onStep?: Step) {
  const id = ropeChainId(p.potId);
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "cancel", args: [id] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep, ropes);
  return walletSend(actor.adapter, actor.account, ropes, data, p.potId, 0n, onStep);
}

/**
 * Records a referrer once, before the account's first v2 pot (the contract refuses otherwise). Silent
 * when there is nothing to do: no referral link used, already set, or the account has played.
 */
export async function maybeSetReferrer(actor: Actor, ropes: Address, onStep?: Step) {
  let ref: string | null = null;
  try {
    ref = localStorage.getItem("hc.ref");
  } catch {}
  if (!ref || !/^0x[0-9a-fA-F]{40}$/.test(ref) || ref.toLowerCase() === actor.account.toLowerCase()) return;
  const [current, count] = await Promise.all([
    publicClient.readContract({ address: ropes, abi: ropesAbi, functionName: "referrerOf", args: [actor.account] }) as Promise<Address>,
    publicClient.readContract({ address: ropes, abi: ropesAbi, functionName: "potCount", args: [actor.account] }) as Promise<bigint>,
  ]).catch(() => [null, null] as const);
  if (current === null || count === null || count > 0n || !/^0x0+$/.test(current)) return;
  onStep?.("Recording who invited you (once)");
  const data = encodeFunctionData({ abi: ropesAbi, functionName: "setReferrer", args: [ref as Address] });
  if (actor.kind === "passkey") await passkeyCall(actor.session, actor.account, data, 0n, onStep, ropes);
  else await walletSend(actor.adapter, actor.account, ropes, data, null, 0n, onStep);
}
