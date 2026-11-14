"use client";

import type { Address, Hex, TypedDataDefinition } from "viem";
import { getJson } from "./api";
import type { WalletAdapter } from "./wallet/types";

/**
 * Browser side of gasless funding. The relay returns the Arc USDC `ReceiveWithAuthorization`
 * typed data (nonce bound to the pot or its parameters); the wallet signs it; the relay submits
 * the transaction and pays gas in USDC. The user never sends a transaction.
 */
type Prepared = {
  salt: Hex;
  nonce: Hex;
  validAfter: string;
  validBefore: string;
  typedData: {
    domain: { name: string; version: string; chainId: number | string; verifyingContract: Address };
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: { from: Address; to: Address; value: string; validAfter: string; validBefore: string; nonce: Hex };
  };
};

export type PotParamsInput = {
  conditionId: Hex;
  resolver: Address;
  payees: Address[];
  sharesBps: number[];
  refundTo: Address;
  deadline: bigint;
};

const post = <T,>(path: string, body: unknown) =>
  getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function sign(adapter: WalletAdapter, from: Address, p: Prepared) {
  const m = p.typedData.message;
  const signature = await adapter.signTypedData({
    domain: { ...p.typedData.domain, chainId: Number(p.typedData.domain.chainId) },
    types: p.typedData.types,
    primaryType: p.typedData.primaryType,
    message: { ...m, value: BigInt(m.value), validAfter: BigInt(m.validAfter), validBefore: BigInt(m.validBefore) },
  } as unknown as TypedDataDefinition);
  return { from, validAfter: p.validAfter, validBefore: p.validBefore, salt: p.salt, signature };
}

const paramsJson = (p: PotParamsInput) => ({ ...p, deadline: p.deadline.toString() });

/** Create + fund in one relay-submitted transaction. Returns the new pot id. */
export async function gaslessCreate(adapter: WalletAdapter, from: Address, params: PotParamsInput, amount: bigint, onSigned?: () => void) {
  const prepared = await post<Prepared>("/api/gasless/prepare", { kind: "create", params: paramsJson(params), from, amount: amount.toString() });
  const authorization = await sign(adapter, from, prepared);
  onSigned?.();
  return post<{ tx: Hex; potId: string | null }>("/api/gasless/create", { params: paramsJson(params), amount: amount.toString(), authorization });
}

/** Top up an open pot with a signature only. */
export async function gaslessFund(adapter: WalletAdapter, from: Address, potId: number, amount: bigint, onSigned?: () => void) {
  const prepared = await post<Prepared>("/api/gasless/prepare", { kind: "fund", potId: String(potId), from, amount: amount.toString() });
  const authorization = await sign(adapter, from, prepared);
  onSigned?.();
  return post<{ tx: Hex; potId: string }>("/api/gasless/fund", { potId: String(potId), amount: amount.toString(), authorization });
}
