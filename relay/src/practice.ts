import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { ARC_USDC } from "./arc";
import { publicClient, relaySender } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { memoCall } from "./memo";
import { potsAbi } from "./potsAbi";
import { potsAddress, syncPot } from "./pots";
import { ropesAbi } from "./ropesAbi";
import { contractOf, isRopeDbId } from "./ropes";
import { perpsAbi } from "./perpsAbi";
import { perpsAddress, syncPerp } from "./perps";
import { sendRelayCalls } from "./txs";

/**
 * The practice cat: HonorCat's own testnet account takes the other side of a small pot so a
 * visitor can try everything alone (create, watch the rope, leave) in about two minutes. Test
 * money only, clearly labelled, at most $2 per pot, a daily budget and a floor on its balance.
 * It never leaves on its own; the visitor's exit or Gemini's result ends the pot.
 */
export const PRACTICE_MAX_NOTIONAL = 2_000_000n;
const PRACTICE_PER_DAY = 30;
const PRACTICE_FLOOR = 4_000_000n; // keep this much for gas and gifts
const ZERO = `0x${"0".repeat(64)}` as Hex;

export function practiceAddress(): Address {
  return relaySender();
}

export async function isPractice(db: Db, potId: string) {
  return (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [potId])).length > 0;
}

/**
 * Whether the practice cat can take a pot right now, checked before a visitor creates one so a
 * practice pot is never left waiting. `reason` is a plain sentence with what to do instead.
 */
export async function practiceStatus(db: Db): Promise<{ available: boolean; reason: string | null }> {
  const today = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots WHERE created_at > now() - interval '1 day'");
  if (Number(today[0]?.n ?? 0) >= PRACTICE_PER_DAY)
    return { available: false, reason: "The practice cat has played enough pots for today. Start a pot for a real opponent, or invite a friend." };
  const bal = await publicClient().readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [practiceAddress()] });
  if (bal < PRACTICE_MAX_NOTIONAL + PRACTICE_FLOOR)
    return { available: false, reason: "The practice cat is out of test money until HonorCat refills it. Start a pot for a real opponent, or invite a friend." };
  return { available: true, reason: null };
}

/** What the joining side of a v2 pot pays in at most: its worst case in the band, plus the maker treat. */
export function ropeJoinCost(p: { creatorSide: number; size: bigint; bandCenter: number; tolerance: number; distYes: number; distNo: number }) {
  const side = 1 - Number(p.creatorSide);
  const dist = side === 0 ? Number(p.distYes) : Number(p.distNo);
  const c = Number(p.bandCenter);
  const t = Number(p.tolerance);
  const per = dist > 0 ? Math.floor(dist / 100) : side === 0 ? Math.floor(Math.min(1_000_000, c + t) / 100) : 10_000 - Math.floor(Math.max(0, c - t) / 100);
  const deposit = BigInt(per) * p.size;
  return deposit + (deposit * 25n) / 10_000n;
}

/** The practice cat joins a HonorCat v2 pot (a normal pot, no posts) the same way any player does. */
async function practiceJoinV2(db: Db, potId: string) {
  const ct = contractOf(potId);
  const c = publicClient();
  const p = (await c.readContract({ address: ct.address, abi: ropesAbi, functionName: "pot", args: [ct.chainPotId] })) as unknown as {
    state: number;
    size: bigint;
    creatorSide: number;
    bandCenter: number;
    tolerance: number;
    distYes: number;
    distNo: number;
    expiry: bigint;
    closeTime: bigint;
  };
  if (Number(p.state) !== 1) throw Object.assign(new Error("this pot is not waiting for a second side"), { status: 409 });
  if (Number(p.expiry) !== 0 || Number(p.distYes) !== 0 || Number(p.distNo) !== 0) throw Object.assign(new Error("the practice cat plays normal pots only"), { status: 400 });
  if (p.size * 10_000n > PRACTICE_MAX_NOTIONAL) throw Object.assign(new Error("the practice cat plays pots up to $2"), { status: 400 });
  if (Number(p.closeTime) - Math.floor(Date.now() / 1000) < 15 * 60) throw Object.assign(new Error("this market closes too soon to practise on"), { status: 409 });
  const today = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots WHERE created_at > now() - interval '1 day'");
  if (Number(today[0]?.n ?? 0) >= PRACTICE_PER_DAY) throw Object.assign(new Error("the practice cat has played enough for today; invite a friend instead"), { status: 429 });
  const me = practiceAddress();
  const cost = ropeJoinCost(p);
  const bal = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (bal < cost + PRACTICE_FLOOR) throw Object.assign(new Error("the practice cat is out of test money right now; invite a friend instead"), { status: 503 });
  const inserted = await db.query("INSERT INTO practice_pots (pot_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING pot_id", [potId]);
  if (!inserted.length) throw Object.assign(new Error("the practice cat already joined this pot"), { status: 409 });
  const calls = [];
  const allowance = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "allowance", args: [me, ct.address] });
  if (allowance < cost) calls.push({ target: ARC_USDC, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [ct.address, maxUint256] }), label: "approve" });
  const join = encodeFunctionData({ abi: ropesAbi, functionName: "requestJoin", args: [ct.chainPotId, 0n, { from: me, validAfter: 0n, validBefore: 0n, salt: ZERO, v: 0, r: ZERO, s: ZERO }] });
  const ref = `pot-${potId}`;
  calls.push({ ...memoCall(ct.address, join, ref, { v: 1, t: "pot", ref, pot: potId, why: "the practice cat takes the other side (test money)" }), label: "practice join" });
  const res = await sendRelayCalls(db, "pot_exec", calls, { atomic: true });
  if (!res.ok) {
    await db.query("DELETE FROM practice_pots WHERE pot_id = $1", [potId]);
    throw Object.assign(new Error(`the practice cat could not join: ${res.error.slice(0, 200)}`), { status: 502 });
  }
  await syncPot(db, BigInt(potId)).catch(() => {});
  return { tx: res.tx, potId, chainId: getConfig().chainId };
}

export async function practiceJoin(db: Db, potId: string) {
  if (isRopeDbId(potId)) return practiceJoinV2(db, potId);
  const pots = potsAddress();
  const c = publicClient();
  const p = (await c.readContract({ address: pots, abi: potsAbi, functionName: "pot", args: [BigInt(potId)] })) as unknown as {
    state: number;
    notional: bigint;
    creatorSide: number;
    bandCenter: number;
    tolerance: number;
    closeTime: bigint;
  };
  if (Number(p.state) !== 1) throw Object.assign(new Error("this pot is not waiting for a second side"), { status: 409 });
  if (p.notional > PRACTICE_MAX_NOTIONAL) throw Object.assign(new Error("the practice cat plays pots up to $2"), { status: 400 });
  if (Number(p.closeTime) - Math.floor(Date.now() / 1000) < 15 * 60) throw Object.assign(new Error("this market closes too soon to practise on"), { status: 409 });
  const today = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots WHERE created_at > now() - interval '1 day'");
  if (Number(today[0]?.n ?? 0) >= PRACTICE_PER_DAY) throw Object.assign(new Error("the practice cat has played enough for today; invite a friend instead"), { status: 429 });
  const me = practiceAddress();
  const side = 1 - Number(p.creatorSide);
  const escrow = (await c.readContract({ address: pots, abi: potsAbi, functionName: "worstCase", args: [side, p.notional, p.bandCenter, p.tolerance] })) as bigint;
  const bal = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (bal < escrow + PRACTICE_FLOOR) throw Object.assign(new Error("the practice cat is out of test money right now; invite a friend instead"), { status: 503 });
  const inserted = await db.query("INSERT INTO practice_pots (pot_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING pot_id", [potId]);
  if (!inserted.length) throw Object.assign(new Error("the practice cat already joined this pot"), { status: 409 });

  const calls = [];
  const allowance = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "allowance", args: [me, pots] });
  if (allowance < escrow) calls.push({ target: ARC_USDC, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [pots, maxUint256] }), label: "approve" });
  const join = encodeFunctionData({ abi: potsAbi, functionName: "requestJoin", args: [BigInt(potId), { from: me, validAfter: 0n, validBefore: 0n, salt: ZERO, v: 0, r: ZERO, s: ZERO }] });
  const ref = `pot-${potId}`;
  calls.push({ ...memoCall(pots, join, ref, { v: 1, t: "pot", ref, pot: potId, why: "the practice cat takes the other side (test money)" }), label: "practice join" });
  const res = await sendRelayCalls(db, "pot_exec", calls, { atomic: true });
  if (!res.ok) {
    await db.query("DELETE FROM practice_pots WHERE pot_id = $1", [potId]);
    throw Object.assign(new Error(`the practice cat could not join: ${res.error.slice(0, 200)}`), { status: 502 });
  }
  await syncPot(db, BigInt(potId)).catch(() => {});
  return { tx: res.tx, potId, chainId: getConfig().chainId };
}

/** Practice perps: small stakes and few lives, so the practice cat's test money lasts. */
export const PRACTICE_PERP_MAX_STAKE = 1_000_000n;
export const PRACTICE_PERP_MAX_LIVES = 3n;

/** Whether a perp is a practice perp (stored with the perp's negative id). */
export async function isPracticePerp(db: Db, perpId: string) {
  return (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [`-${perpId}`])).length > 0;
}

/**
 * The practice cat takes the other side of an open perp: as many lives as the creator brought (at
 * most 3), plus the maker treat, like any player. It never leaves or stops renewing on its own.
 */
export async function practiceJoinPerp(db: Db, perpId: string) {
  const perps = perpsAddress();
  if (!perps) throw Object.assign(new Error("perps are not deployed"), { status: 503 });
  const c = publicClient();
  const q = (await c.readContract({ address: perps, abi: perpsAbi, functionName: "perp", args: [BigInt(perpId)] })) as unknown as { phase: number; freeA: bigint; t: { closeTime: bigint } };
  if (Number(q.phase) !== 1) throw Object.assign(new Error("this perp is not waiting for a second player"), { status: 409 });
  const stake = (await c.readContract({ address: perps, abi: perpsAbi, functionName: "stake", args: [BigInt(perpId)] })) as bigint;
  if (stake > PRACTICE_PERP_MAX_STAKE) throw Object.assign(new Error("the practice cat plays perps up to $1 per life"), { status: 400 });
  if (Number(q.t.closeTime) - Math.floor(Date.now() / 1000) < 3 * 3600) throw Object.assign(new Error("this market closes too soon to practise on"), { status: 409 });
  const today = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM practice_pots WHERE created_at > now() - interval '1 day'");
  if (Number(today[0]?.n ?? 0) >= PRACTICE_PER_DAY) throw Object.assign(new Error("the practice cat has played enough for today; invite a friend instead"), { status: 429 });
  const creatorLives = q.freeA / stake;
  const lives = creatorLives < 1n ? 1n : creatorLives > PRACTICE_PERP_MAX_LIVES ? PRACTICE_PERP_MAX_LIVES : creatorLives;
  const budget = lives * stake + (stake * 25n) / 10_000n;
  const me = practiceAddress();
  const bal = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (bal < budget + PRACTICE_FLOOR) throw Object.assign(new Error("the practice cat is out of test money right now; invite a friend instead"), { status: 503 });
  const inserted = await db.query("INSERT INTO practice_pots (pot_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING pot_id", [`-${perpId}`]);
  if (!inserted.length) throw Object.assign(new Error("the practice cat already joined this perp"), { status: 409 });
  const calls = [];
  const allowance = await c.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "allowance", args: [me, perps] });
  if (allowance < budget) calls.push({ target: ARC_USDC, callData: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [perps, maxUint256] }), label: "approve" });
  const join = encodeFunctionData({ abi: perpsAbi, functionName: "join", args: [BigInt(perpId), budget] });
  const ref = `perp-${perpId}`;
  calls.push({ ...memoCall(perps, join, ref, { v: 1, t: "pot", ref, why: "the practice cat takes the other side (test money)" }), label: "practice join" });
  const res = await sendRelayCalls(db, "pot_exec", calls, { atomic: true });
  if (!res.ok) {
    await db.query("DELETE FROM practice_pots WHERE pot_id = $1", [`-${perpId}`]);
    throw Object.assign(new Error(`the practice cat could not join: ${res.error.slice(0, 200)}`), { status: 502 });
  }
  await syncPerp(db, BigInt(perpId)).catch(() => {});
  return { tx: res.tx, perpId, lives: lives.toString() };
}
