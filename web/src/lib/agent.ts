"use client";

import { encodeAbiParameters, getAddress, type Address, type Hex } from "viem";
import { getJson } from "./api";
import { publicClient } from "./chain";
import { potsAbi, type Actor } from "./hc";
import { joinChallenge, signChallenge } from "./passkey";

/**
 * Agent seats and the cat sitter, from the player's side: every request is signed by the player
 * (wallet signature or one passkey confirmation). The message texts match relay/src/agentSeats.ts
 * and relay/src/catSitter.ts exactly.
 */
export type Power = "alone" | "approval" | "off";
export type Powers = { setNet: Power; setBowl: Power; partialExit: Power; fullExit: Power; acceptHandshake: Power };
export const POWER_KEYS: (keyof Powers)[] = ["setNet", "setBowl", "partialExit", "fullExit", "acceptHandshake"];
export const CAN_BE_ALONE: (keyof Powers)[] = ["partialExit", "fullExit"];
export const POWER_LABEL: Record<keyof Powers, string> = {
  setNet: "Set a net",
  setBowl: "Set a bowl",
  partialExit: "Partial exit (one ninth)",
  fullExit: "Full exit",
  acceptHandshake: "Accept a handshake",
};
export type SeatView = { id: string; label: string; expiresAt: string; revokedAt: string | null; createdAt: string; pots: number; actions: number; active: boolean };

async function prove(actor: Actor, message: string) {
  return actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
}
const post = <T>(url: string, body: unknown, method = "POST") => getJson<T>(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function createSeat(actor: Actor, label: string) {
  const issuedAt = new Date().toISOString();
  const clean = label.replace(/\s+/g, " ").trim().slice(0, 40) || "My Grok Bot";
  const message = `HonorCat: let my agent "${clean}" play my practice pots.\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  return post<{ id: string; token: string; label: string; expiresInHours: number }>("/api/hc/agent/seats", { action: "create", account: actor.account, label: clean, issuedAt, ...(await prove(actor, message)) });
}

export async function revokeSeat(actor: Actor, seatId: string) {
  const issuedAt = new Date().toISOString();
  const message = `HonorCat: revoke agent seat ${seatId}.\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  return post("/api/hc/agent/seats", { action: "revoke", account: actor.account, seatId, issuedAt, ...(await prove(actor, message)) });
}

export const seatsOf = (account: string) => getJson<{ seats: SeatView[] }>(`/api/hc/agent/seats?account=${account}`);

/** The powers as the server stores them (same key order; only exits can be "alone"). */
export function cleanPowers(p: Partial<Powers>): Powers {
  const out = {} as Powers;
  for (const k of POWER_KEYS) {
    const v = p[k] ?? "off";
    out[k] = v === "alone" && !CAN_BE_ALONE.includes(k) ? "approval" : v;
  }
  return out;
}

const exitTypes = {
  ExitRequest: [
    { name: "potId", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "notional", type: "uint256" },
    { name: "sigNonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** One exit signed in advance (used once by the relay when the sitter decides; expires with the seat). */
export async function signExitInAdvance(actor: Actor, pots: Address, potId: string, side: number, notional: bigint, deadline: number): Promise<Hex> {
  if (actor.kind === "wallet") {
    const sigNonce = (await publicClient.readContract({ address: pots, abi: potsAbi, functionName: "sigNonce", args: [BigInt(potId) * 2n + BigInt(side)] })) as bigint;
    return actor.adapter.signTypedData({
      domain: { name: "HonorCatPots", version: "1", chainId: 5042002, verifyingContract: pots },
      types: exitTypes,
      primaryType: "ExitRequest",
      message: { potId: BigInt(potId), side, notional, sigNonce, deadline: BigInt(deadline) },
    });
  }
  const digest = (await publicClient.readContract({ address: pots, abi: potsAbi, functionName: "exitRequestDigest", args: [BigInt(potId), side, notional, BigInt(deadline)] })) as Hex;
  const a = await signChallenge(actor.session, digest);
  return encodeAbiParameters(
    [{ type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes" }, { type: "string" }],
    [a.r, a.s, BigInt(a.challengeIndex), BigInt(a.typeIndex), a.authenticatorData, a.clientDataJSON],
  );
}

export async function attachSitter(
  actor: Actor,
  input: { seatId: string; potId: string; powers: Powers; exits?: { full?: { sig: Hex; notional: string; deadline: number } | null; partial?: { sig: Hex; notional: string; deadline: number } | null } },
) {
  const issuedAt = new Date().toISOString();
  const powers = cleanPowers(input.powers);
  const message = `HonorCat: let my cat sitter ${input.seatId} mind pot ${input.potId}.\nPowers: ${POWER_KEYS.map((k) => `${k}=${powers[k]}`).join(", ")}\nAccount: ${getAddress(actor.account)}\nIssued: ${issuedAt}`;
  return post("/api/hc/agent/attach", { account: actor.account, seatId: input.seatId, potId: input.potId, powers, exits: input.exits, issuedAt, ...(await prove(actor, message)) });
}

export const detachSitter = (account: string, potId: string) => post("/api/hc/agent/attach", { account, potId }, "DELETE");
export const decideProposal = (id: string, decision: "approved" | "declined") => post("/api/hc/agent/proposals", { id, decision });
export const inviteMyAgent = (potId: string) => post("/api/hc/agent/invite", { potId });

export type AgentInfo = {
  sitter: { label: string; side: number; powers: Powers } | null;
  opponent: { label: string } | null;
  actions: { action: string; ok: boolean; reason: string | null; at: string; label: string; detail: string | null }[];
  proposals: { id: string; action: string; args: { percent?: number; part?: string; side?: number }; reason: string; status: string; created_at: string }[];
};
