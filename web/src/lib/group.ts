"use client";

import { encodeFunctionData, parseEventLogs, type Address, type Hex } from "viem";
import { groupsAbi } from "@honorcat/relay/groupsAbi";
import { getJson } from "./api";
import { publicClient } from "./chain";
import { ensureFunds, passkeyCall, waitDepth, walletSend, type Actor, type Step } from "./hc";
import { joinChallenge, signChallenge } from "./passkey";

/**
 * Group pots in the browser: types mirroring /api/hc/groups and every player action. Two teams
 * take opposite sides of one market; joins and leaves are gathered for a minute and priced
 * together over the 30 seconds after (one batch). A member's notional n is worth n × p on the
 * first team and n × (1 − p) on the second, and pays n if their team's side is the result.
 */
export const P = 1_000_000;
export const PERIOD_S = 60;
export const MAX_WAIT_BATCHES = 20;

export type GroupsStatus = { available: boolean; on: boolean; address: Address | null; period: number; maxWaitBatches: number; exitFeeBps: number; minJoin: string; maxNotional: string };
export type GroupSummary = { groupId: string; state: GroupState; conditionId: Hex; closeTime: number; names: [string, string]; pools: [string, string]; members: [number, number] };
export type GroupState = "None" | "Open" | "Settled" | "Void";
export type MemberStanding = {
  team: number | null;
  member: boolean;
  position: { active: boolean; notional: string; pending: string };
  request: { batch: string; wait: boolean; escrow: string } | null;
  exit: { batch: string; notional: string } | null;
  claimable: string;
};
export type GroupDetail = {
  groupId: string;
  state: GroupState;
  creator: string;
  conditionId: Hex;
  closeTime: number;
  deadline: number;
  createdAt: number;
  window: number;
  cap: string;
  outcome: number;
  names: [string, string];
  lines: [string, string] | null;
  nextBatch: string | null;
  teams: { pool: string; exiting: string; deposits: string; members: number }[];
  clock: { now: number; currentBatch: number; collectingUntil: number; window: { start: number; end: number } };
  prices: { batch: string; price: number; matched: string; at: number | null; tx: string }[];
  pricing: { id: string; status: string; batch: string; windowStart: number; windowEnd: number; error: string | null }[];
  events?: { name: string; args: Record<string, string>; at: number | null; tx: string }[];
  market: { instrument: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string } | null;
  mine: MemberStanding | null;
};
export type PreparedGroup = {
  conditionId: Hex;
  resolver: Address;
  groups: Address;
  chainId: number;
  closeTime: number;
  window: number;
  minSamples: number;
  grace: number;
  depthId: string;
  depth: { conditionId: Hex; account: Address; contracts5c: string; spread?: number; crypto?: boolean; closeTime: string; validUntil: string };
  cap: string;
  crypto: boolean;
  midPpm: number | null;
  market: { symbol: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string; category: string; closeMs: number };
};

/** A team's own price (ppm) from the YES price. */
export const teamPrice = (priceYes: number, team: number) => (team === 0 ? priceYes : P - priceYes);
/** What a notional is worth on a team at a YES price (base units). */
export const valueOf = (notional: bigint, priceYes: number, team: number) => (notional * BigInt(teamPrice(priceYes, team))) / BigInt(P);

export const getGroups = (account?: string | null) => getJson<{ status: GroupsStatus; groups: GroupSummary[] }>(`/api/hc/groups${account ? `?account=${account}` : ""}`);
export const groupPath = (id: string, account?: string | null) => `/api/hc/groups/${id}${account ? `?account=${account}` : ""}`;
const resync = (id: string, account: Address) => getJson<GroupDetail>(groupPath(id, account), { method: "POST" }).catch(() => null);

export async function prepareGroup(symbol: string, account: Address) {
  return getJson<PreparedGroup>("/api/hc/prepare-group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbol, account }) });
}

async function groupCall(actor: Actor, groups: Address, data: Hex, spend: bigint, groupId: string | null, onStep?: Step) {
  if (spend > 0n) await ensureFunds(actor.account, spend, onStep);
  if (actor.kind === "passkey") {
    const r = (await passkeyCall(actor.session, actor.account, data, spend, onStep, groups)) as { tx: Hex; groupId?: string | null };
    const id = r.groupId ?? groupId;
    if (id) await resync(id, actor.account);
    return { tx: r.tx, groupId: id ?? null };
  }
  const r = await walletSend(actor.adapter, actor.account, groups, data, null, spend, onStep);
  let id = groupId;
  if (!id) {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: r.tx, timeout: 60_000 }).catch(() => null);
    const ev = receipt ? parseEventLogs({ abi: groupsAbi, logs: receipt.logs, eventName: "GroupCreated" })[0] : undefined;
    if (ev) id = (ev.args as { groupId: bigint }).groupId.toString();
  }
  if (id) await resync(id, actor.account);
  return { tx: r.tx, groupId: id };
}

/** Opens a group on a market with both team names (no money moves; the creator joins after). */
export async function createGroup(actor: Actor, prep: PreparedGroup, names: [string, string], onStep?: Step) {
  const sigs = await waitDepth(prep.depthId, onStep);
  const d = prep.depth;
  const depth = { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), spread: d.spread ?? 0, crypto: d.crypto ?? false, closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) };
  const data = encodeFunctionData({ abi: groupsAbi, functionName: "create", args: [prep.resolver, depth, sigs, BigInt(prep.grace), prep.window, prep.minSamples, names[0], names[1]] });
  return groupCall(actor, prep.groups, data, 0n, null, onStep);
}

/** A join request: `amount` (base units) on `team`, cleared in the next batch; `wait` keeps an unmatched rest waiting. */
export async function joinTeam(actor: Actor, groups: Address, groupId: string, team: number, amount: bigint, wait: boolean, onStep?: Step) {
  const data = encodeFunctionData({ abi: groupsAbi, functionName: "join", args: [BigInt(groupId), team, amount, wait] });
  return groupCall(actor, groups, data, amount, groupId, onStep);
}

/** A leave request for `notional` (all or part), priced in the next batch. */
export async function leaveGroup(actor: Actor, groups: Address, groupId: string, notional: bigint, onStep?: Step) {
  const data = encodeFunctionData({ abi: groupsAbi, functionName: "leave", args: [BigInt(groupId), notional] });
  return groupCall(actor, groups, data, 0n, groupId, onStep);
}

/** Brings the account up to date (fills, refunds, payouts), then takes out what the group owes it. */
export async function collect(actor: Actor, groups: Address, groupId: string, onStep?: Step) {
  const claim = encodeFunctionData({ abi: groupsAbi, functionName: "claim", args: [BigInt(groupId), actor.account] });
  await groupCall(actor, groups, claim, 0n, groupId, onStep);
  const owed = (await publicClient.readContract({ address: groups, abi: groupsAbi, functionName: "claimable", args: [BigInt(groupId), actor.account] })) as bigint;
  if (owed === 0n) return { tx: null, amount: 0n };
  const data = encodeFunctionData({ abi: groupsAbi, functionName: "withdraw", args: [BigInt(groupId)] });
  const r = await groupCall(actor, groups, data, 0n, groupId, onStep);
  return { tx: r.tx, amount: owed };
}

/** Sends the whole position to another account (no money moves through HonorCat). */
export async function sendPosition(actor: Actor, groups: Address, groupId: string, to: Address, onStep?: Step) {
  const data = encodeFunctionData({ abi: groupsAbi, functionName: "transferPosition", args: [BigInt(groupId), to] });
  return groupCall(actor, groups, data, 0n, groupId, onStep);
}

export async function setTeamLines(actor: Actor, groupId: string, lines: [string, string]) {
  // Signed by the creator: the relay accepts team lines only with the creator's own signature.
  const { getAddress } = await import("viem");
  const issuedAt = new Date().toISOString();
  const message = `HonorCat: the team lines of group ${groupId}: "${lines[0]}" / "${lines[1]}".
Account: ${getAddress(actor.account)}
Issued: ${issuedAt}`;
  const proof = actor.kind === "wallet" ? { signature: await actor.adapter.signMessage!(message) } : { passkey: await signChallenge(actor.session, await joinChallenge(message)) };
  return getJson<{ ok: boolean }>(`/api/hc/groups/${groupId}/lines`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: actor.account, lines, issuedAt, ...proof }) });
}

/** A group event in plain words ("Mochi joined Texas with $5"), newest first; null for the quiet ones. */
export function groupEventText(e: { name: string; args: Record<string, string> }, names: [string, string], who: (a: string) => string, money: (b: string | bigint) => string): string | null {
  const a = e.args;
  const team = (t: string | number | undefined) => names[Number(t ?? 0)] ?? "a team";
  switch (e.name) {
    case "GroupCreated":
      return `${who(a.creator ?? "")} opened the group: ${names[0]} against ${names[1]}`;
    case "JoinRequested":
      return `${who(a.account ?? "")} joined ${team(a.team)} with ${money(a.amount ?? "0")}`;
    case "LeaveRequested":
      return `${who(a.account ?? "")} is leaving ${team(a.team)}`;
    case "BatchCleared": {
      const parts: string[] = [];
      if (BigInt(a.matched ?? "0") > 0n) parts.push(`${money(a.matched ?? "0")} matched at ${(Number(a.price) / 10_000).toFixed(1)}%`);
      if (BigInt(a.shrinkYes ?? "0") > 0n) parts.push(`${names[0]} shrank by ${money(a.shrinkYes ?? "0")}`);
      if (BigInt(a.shrinkNo ?? "0") > 0n) parts.push(`${names[1]} shrank by ${money(a.shrinkNo ?? "0")}`);
      if (BigInt(a.takeoverYes ?? "0") > 0n || BigInt(a.takeoverNo ?? "0") > 0n) parts.push("waiting joins took over a leaver's share");
      return parts.length ? parts.join("; ") : null;
    }
    case "BatchFailed":
      return "No agreed price for a batch: its requests went back";
    case "GroupSettled":
      return Number(a.outcome) === 2 ? "Gemini settled it void: every deposit goes back" : `Gemini settled it: ${team(Number(a.outcome) === 1 ? 0 : 1)} land the pot`;
    case "GroupVoided":
      return "No result in time: every deposit goes back";
    default:
      return null;
  }
}
