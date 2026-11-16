import { encodeFunctionData, erc20Abi, maxUint256, type Address, type Hex } from "viem";
import { ARC_USDC } from "./arc";
import { publicClient, relaySender } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { memoCall } from "./memo";
import { potsAbi } from "./potsAbi";
import { potsAddress, syncPot } from "./pots";
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

export async function practiceJoin(db: Db, potId: string) {
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
