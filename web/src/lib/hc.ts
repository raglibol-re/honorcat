"use client";

import { encodeAbiParameters, encodeFunctionData, keccak256, parseSignature, stringToBytes, type Address, type Hex } from "viem";
import { potsAbi } from "@honorcat/relay/potsAbi";
import { getJson } from "./api";
import { publicClient, USDC_ADDRESS } from "./chain";
import { signChallenge, type PasskeySession } from "./passkey";
import type { WalletAdapter } from "./wallet/types";

/**
 * Two-sided pots in the browser: types mirroring /api/hc, the share arithmetic of the contract,
 * and every user action for both kinds of account:
 * - passkey accounts sign `execute` challenges; HonorCat pays the fee;
 * - wallets sign EIP-3009 deposits and EIP-712 exit requests (forwarded, no gas), or send directly.
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
export type PotMarket = { conditionId: Hex; instrument: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string };
export type HcPot = {
  potId: string;
  state: PotStateName;
  data: PotData;
  owners: { yes: Address | null; no: Address | null };
  createdTx: string | null;
  updatedAt: string;
  market: PotMarket | null;
  requests: AttRequest[];
};
export type HcPotSummary = Omit<HcPot, "requests" | "createdTx" | "market"> & { market: { eventTitle: string; label: string; instrument: string; eventTicker: string } | null };

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
const DEPOSIT_TAG = keccak256(stringToBytes("HonorCatPots.deposit"));
const ZERO32 = `0x${"0".repeat(64)}` as Hex;
const noAuth = (from: Address) => ({ from, validAfter: 0n, validBefore: 0n, salt: ZERO32, v: 0, r: ZERO32, s: ZERO32 });

let usdcDomainCache: Promise<{ name: string; version: string; chainId: number; verifyingContract: Address }> | null = null;
function usdcDomain() {
  usdcDomainCache ??= (async () => {
    const abi = [
      { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
      { type: "function", name: "version", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
    ] as const;
    const [name, version] = await Promise.all([
      publicClient.readContract({ address: USDC_ADDRESS, abi, functionName: "name" }),
      publicClient.readContract({ address: USDC_ADDRESS, abi, functionName: "version" }),
    ]);
    return { name, version, chainId: 5042002, verifyingContract: USDC_ADDRESS as Address };
  })();
  return usdcDomainCache;
}

const receiveTypes = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/** EIP-3009 deposit authorization bound to one action (the contract recomputes the nonce). */
async function walletAuth(adapter: WalletAdapter, from: Address, pots: Address, value: bigint, action: Hex) {
  const salt = keccak256(crypto.getRandomValues(new Uint8Array(32)));
  const nonce = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "bytes32" }, { type: "bytes32" }], [DEPOSIT_TAG, 5042002n, pots, action, salt]));
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const sig = await adapter.signTypedData({
    domain: await usdcDomain(),
    types: receiveTypes,
    primaryType: "ReceiveWithAuthorization",
    message: { from, to: pots, value, validAfter: 0n, validBefore, nonce },
  });
  const { r, s, v } = parseSignature(sig);
  return { from, validAfter: 0n, validBefore, salt, v: Number(v ?? 27n), r, s };
}

/** Runs a pot call from a passkey account: one passkey prompt per step (an approval may come first). */
async function passkeyCall(session: PasskeySession, account: Address, data: Hex, spend: bigint, onStep?: (s: string) => void) {
  const prep = await getJson<{ steps: { target: Address; data: Hex; deadline: string; nonce: string; challenge: Hex; label: string }[] }>("/api/hc/passkey/prepare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account, data, spend: spend.toString() }),
  });
  const signed = [];
  for (const [i, s] of prep.steps.entries()) {
    onStep?.(prep.steps.length > 1 ? `Confirm with your passkey (${i + 1} of ${prep.steps.length}): ${s.label}` : "Confirm with your passkey");
    signed.push({ target: s.target, data: s.data, deadline: s.deadline, nonce: s.nonce, assertion: await signChallenge(session, s.challenge) });
  }
  onStep?.("Sending");
  return getJson<{ tx: Hex; potId: string | null }>("/api/hc/passkey/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account, steps: signed }) });
}

const forward = (data: Hex) => getJson<{ tx: Hex; potId: string | null }>("/api/hc/forward", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data }) });

/** A direct transaction from a wallet (it pays the fee in USDC), then a re-read of the pot. */
async function walletSend(adapter: WalletAdapter, pots: Address, data: Hex, potId: string | null) {
  const tx = await adapter.send({ to: pots, data });
  await publicClient.waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
  if (potId) await getJson(`/api/hc/pots/${potId}`, { method: "POST" }).catch(() => null);
  return { tx, potId };
}

export type Step = (s: string) => void;

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
  if (actor.kind === "passkey") {
    const data = encodeFunctionData({ abi: potsAbi, functionName: "create", args: [c, depth, sigs, noAuth(actor.account)] });
    return passkeyCall(actor.session, actor.account, data, escrow, onStep);
  }
  const tuple = {
    type: "tuple",
    components: [
      { name: "conditionId", type: "bytes32" },
      { name: "resolver", type: "address" },
      { name: "side", type: "uint8" },
      { name: "notional", type: "uint256" },
      { name: "bandCenter", type: "uint32" },
      { name: "tolerance", type: "uint32" },
      { name: "closeTime", type: "uint64" },
      { name: "grace", type: "uint64" },
      { name: "window", type: "uint32" },
      { name: "minSamples", type: "uint32" },
    ],
  } as const;
  const action = keccak256(encodeAbiParameters([{ type: "string" }, { type: "address" }, tuple], ["create", actor.account, c]));
  onStep?.("Sign the deposit in your wallet (no fee)");
  const auth = await walletAuth(actor.adapter, actor.account, prep.pots, escrow, action);
  onStep?.("Sending");
  return forward(encodeFunctionData({ abi: potsAbi, functionName: "create", args: [c, depth, sigs, auth] }));
}

export async function joinPot(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const side = 1 - Number(p.data.creatorSide);
  const escrow = worstCase(side, BigInt(p.data.notional), Number(p.data.bandCenter), Number(p.data.tolerance));
  const potId = BigInt(p.potId);
  if (actor.kind === "passkey") {
    const data = encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [potId, noAuth(actor.account)] });
    return passkeyCall(actor.session, actor.account, data, escrow, onStep);
  }
  const nonce = BigInt(p.data.nonce) + 1n;
  const action = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }], ["join", potId, actor.account, nonce]));
  onStep?.("Sign the deposit in your wallet (no fee)");
  const auth = await walletAuth(actor.adapter, actor.account, pots, escrow, action);
  onStep?.("Sending");
  return forward(encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [potId, auth] }));
}

export async function requestExit(actor: Actor, pots: Address, p: HcPot, side: number, notional: bigint, onStep?: Step) {
  const potId = BigInt(p.potId);
  if (actor.kind === "passkey") {
    return passkeyCall(actor.session, actor.account, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [potId, side, notional] }), 0n, onStep);
  }
  const tokenId = potId * 2n + BigInt(side);
  const sigNonce = (await publicClient.readContract({ address: pots, abi: potsAbi, functionName: "sigNonce", args: [tokenId] })) as bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  onStep?.("Sign the exit request in your wallet (no fee)");
  const sig = await actor.adapter.signTypedData({
    domain: potsDomain(pots),
    types: {
      ExitRequest: [
        { name: "potId", type: "uint256" },
        { name: "side", type: "uint8" },
        { name: "notional", type: "uint256" },
        { name: "sigNonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "ExitRequest",
    message: { potId, side, notional, sigNonce, deadline },
  });
  onStep?.("Sending");
  return forward(encodeFunctionData({ abi: potsAbi, functionName: "requestExitFor", args: [potId, side, notional, deadline, sig] }));
}

export async function setLevels(actor: Actor, pots: Address, p: HcPot, side: number, net: number, bowl: number, onStep?: Step) {
  const data = encodeFunctionData({ abi: potsAbi, functionName: "setLevels", args: [BigInt(p.potId), side, net, bowl] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep);
  onStep?.("Confirm in your wallet (a small fee in USDC)");
  return walletSend(actor.adapter, pots, data, p.potId);
}

export async function takeover(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const potId = BigInt(p.potId);
  const n = BigInt(p.data.notional);
  if (actor.kind === "passkey") {
    return passkeyCall(actor.session, actor.account, encodeFunctionData({ abi: potsAbi, functionName: "takeover", args: [potId, noAuth(actor.account)] }), n, onStep);
  }
  const action = keccak256(encodeAbiParameters([{ type: "string" }, { type: "uint256" }, { type: "address" }, { type: "uint64" }], ["takeover", potId, actor.account, BigInt(p.data.nonce)]));
  onStep?.("Sign the deposit in your wallet (no fee)");
  const auth = await walletAuth(actor.adapter, actor.account, pots, n, action);
  onStep?.("Sending");
  return forward(encodeFunctionData({ abi: potsAbi, functionName: "takeover", args: [potId, auth] }));
}

export async function cancelPot(actor: Actor, pots: Address, p: HcPot, onStep?: Step) {
  const data = encodeFunctionData({ abi: potsAbi, functionName: "cancel", args: [BigInt(p.potId)] });
  if (actor.kind === "passkey") return passkeyCall(actor.session, actor.account, data, 0n, onStep);
  onStep?.("Confirm in your wallet (a small fee in USDC)");
  return walletSend(actor.adapter, pots, data, p.potId);
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
