import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { memoCall } from "./memo";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { potsAddress, syncPot } from "./pots";
import { potsAbi } from "./potsAbi";
import { sendRelayCalls } from "./txs";

/**
 * The cat sitter: an agent seat minding one of its player's OWN pots. The player's side stays with
 * the player's account; HonorCat never holds its key. Without a contract change the sitter can act
 * alone only on exits the player signed in advance (`requestExitFor`, one use, expiring with the
 * seat). Nets, bowls and accepting a handshake are proposals: the player confirms each with their
 * own passkey or wallet. Every action and proposal carries the agent's one-line reason.
 */
export type Power = "alone" | "approval" | "off";
export type Powers = { setNet: Power; setBowl: Power; partialExit: Power; fullExit: Power; acceptHandshake: Power };
export const OFF: Powers = { setNet: "off", setBowl: "off", partialExit: "off", fullExit: "off", acceptHandshake: "off" };
/** Which powers can be "alone" at all without a contract change: only exits signed in advance. */
export const CAN_BE_ALONE: (keyof Powers)[] = ["partialExit", "fullExit"];

const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** What the sitter may do with `power` for this action: act, propose, or nothing. Pure. */
export function decide(powers: Powers, power: keyof Powers): "act" | "propose" | "refuse" {
  const p = powers[power];
  if (p === "alone" && CAN_BE_ALONE.includes(power)) return "act";
  if (p === "alone" || p === "approval") return "propose";
  return "refuse";
}

export function cleanPowers(input: Partial<Record<keyof Powers, string>>): Powers {
  const out: Powers = { ...OFF };
  for (const k of Object.keys(OFF) as (keyof Powers)[]) {
    const v = input[k];
    if (v === "alone" || v === "approval" || v === "off") out[k] = v === "alone" && !CAN_BE_ALONE.includes(k) ? "approval" : v;
  }
  return out;
}

export const attachMessage = (account: string, seatId: string, potId: string, powers: Powers, issuedAt: string) =>
  `HonorCat: let my cat sitter ${seatId} mind pot ${potId}.\nPowers: ${Object.entries(powers)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ")}\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

type Attach = {
  account: Address;
  seatId: string;
  potId: string;
  powers: Partial<Record<keyof Powers, string>>;
  issuedAt: string;
  /** Exits signed in advance (EIP-712 ExitRequest, or a passkey's ERC-1271 encoding), when allowed alone. */
  exits?: { full?: { sig: Hex; notional: string; deadline: number } | null; partial?: { sig: Hex; notional: string; deadline: number } | null };
} & ({ signature: Hex } | { passkey: WebAuthnAssertion });

/** The player attaches one of their seats to one of their own live pots, with powers per action. */
export async function attachSitter(db: Db, input: Attach) {
  const t = Date.parse(input.issuedAt);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 10 * 60_000) throw fail("the signed request is too old; sign again", 401);
  const account = getAddress(input.account);
  const seat = (await db.query<{ id: string; account: string; expires_at: string }>("SELECT id, account, expires_at::text AS expires_at FROM agent_seats WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()", [input.seatId]))[0];
  if (!seat || seat.account !== account.toLowerCase()) throw fail("no such active seat of yours", 404);
  const powers = cleanPowers(input.powers);
  const message = attachMessage(account, input.seatId, input.potId, powers, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw fail("signature does not match the account", 401);
  } else await verifyPasskeyJoin(db, account, message, input.passkey);

  const c = publicClient();
  const pots = potsAddress();
  const owner = async (side: number) => String(await c.readContract({ address: pots, abi: potsAbi, functionName: "ownerOf", args: [BigInt(input.potId) * 2n + BigInt(side)] }).catch(() => "")).toLowerCase();
  const side = (await owner(0)) === account.toLowerCase() ? 0 : (await owner(1)) === account.toLowerCase() ? 1 : null;
  if (side === null) throw fail("you do not hold a side in that pot", 403);
  const p = (await c.readContract({ address: pots, abi: potsAbi, functionName: "pot", args: [BigInt(input.potId)] })) as unknown as { notional: bigint; state: number };
  if (Number(p.state) !== 3) throw fail("a cat sitter can mind live pots only", 409);
  if (p.notional > 25_000_000n) throw fail("test pots only (up to $25)", 403);

  // Exits signed in advance must be valid now and expire no later than the seat.
  const seatEnd = Math.floor(Date.parse(seat.expires_at) / 1000);
  const check = async (e: { sig: Hex; notional: string; deadline: number } | null | undefined, kind: "full" | "partial") => {
    if (!e) return null;
    const n = BigInt(e.notional);
    if (n <= 0n || n > p.notional || (kind === "full" && n !== p.notional)) throw fail(`the ${kind} exit amount does not fit the pot`);
    if (e.deadline > seatEnd + 60 || e.deadline <= Math.floor(Date.now() / 1000)) throw fail("an exit signed in advance must expire with the seat");
    const digest = (await c.readContract({ address: pots, abi: potsAbi, functionName: "exitRequestDigest", args: [BigInt(input.potId), side, n, BigInt(e.deadline)] })) as Hex;
    const ok = await c.verifyHash({ address: account, hash: digest, signature: e.sig }).catch(() => false);
    if (!ok) throw fail(`the ${kind} exit signature is not valid for this pot`, 401);
    return { sig: e.sig, notional: n.toString(), deadline: e.deadline };
  };
  const full = powers.fullExit === "alone" ? await check(input.exits?.full, "full") : null;
  const partial = powers.partialExit === "alone" ? await check(input.exits?.partial, "partial") : null;
  if (powers.fullExit === "alone" && !full) throw fail("acting alone on a full exit needs that exit signed in advance");
  if (powers.partialExit === "alone" && !partial) throw fail("acting alone on a partial exit needs that exit signed in advance");

  await db.query(
    `INSERT INTO seat_pots (pot_id, seat_id, account, side, powers, exit_full, exit_partial) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (pot_id) DO UPDATE SET seat_id = EXCLUDED.seat_id, account = EXCLUDED.account, side = EXCLUDED.side, powers = EXCLUDED.powers,
       exit_full = EXCLUDED.exit_full, exit_partial = EXCLUDED.exit_partial, detached_at = NULL, created_at = now()`,
    [input.potId, input.seatId, account.toLowerCase(), side, JSON.stringify(powers), full ? JSON.stringify(full) : null, partial ? JSON.stringify(partial) : null],
  );
  return { potId: input.potId, seatId: input.seatId, side, powers };
}

export async function detachSitter(db: Db, potId: string, account: string) {
  await db.query("UPDATE seat_pots SET detached_at = now() WHERE pot_id = $1 AND account = $2", [potId, account.toLowerCase()]);
}

type Minded = { pot_id: string; seat_id: string; account: string; side: number; powers: Powers | string; exit_full: unknown; exit_partial: unknown };

/** The pot this seat minds (attached, not detached), if any. */
export async function mindedPot(db: Db, seatId: string, potId: string) {
  const r = (await db.query<Minded>("SELECT * FROM seat_pots WHERE pot_id = $1 AND seat_id = $2 AND detached_at IS NULL", [potId, seatId]))[0];
  if (!r) return null;
  const parse = <T>(v: unknown) => (v == null ? null : ((typeof v === "string" ? JSON.parse(v) : v) as T));
  return {
    potId: r.pot_id,
    side: Number(r.side),
    account: r.account,
    powers: parse<Powers>(r.powers)!,
    exitFull: parse<{ sig: Hex; notional: string; deadline: number }>(r.exit_full),
    exitPartial: parse<{ sig: Hex; notional: string; deadline: number }>(r.exit_partial),
  };
}

async function propose(db: Db, seatId: string, potId: string, action: string, args: Record<string, unknown>, reason: string) {
  const r = await db.query<{ id: string }>("INSERT INTO agent_proposals (pot_id, seat_id, action, args, reason) VALUES ($1,$2,$3,$4,$5) RETURNING id::text AS id", [
    potId,
    seatId,
    action,
    JSON.stringify(args),
    reason,
  ]);
  return { proposed: true, proposalId: r[0]!.id, note: "Waiting for the player to confirm in HonorCat." };
}

/** One sitter action on a minded pot: act when allowed alone, else propose, else refuse. */
export async function sitterAct(db: Db, seatId: string, potId: string, action: "set_net" | "set_bowl" | "request_exit" | "accept_handshake", args: { percent?: number; part?: "full" | "partial" }, reason: string) {
  const m = await mindedPot(db, seatId, potId);
  if (!m) throw fail("this seat does not mind that pot", 403);
  const power: keyof Powers =
    action === "set_net" ? "setNet" : action === "set_bowl" ? "setBowl" : action === "accept_handshake" ? "acceptHandshake" : args.part === "partial" ? "partialExit" : "fullExit";
  const d = decide(m.powers, power);
  if (d === "refuse") throw fail(`the player did not give the sitter "${power}" on this pot`, 403);
  if (action === "set_net" || action === "set_bowl") {
    const pct = Number(args.percent);
    if (!(pct > 0 && pct < 100)) throw fail("give a percentage between 0 and 100 for the player's own side");
    return propose(db, seatId, potId, action, { percent: pct, side: m.side }, reason);
  }
  if (action === "accept_handshake") return propose(db, seatId, potId, action, { side: m.side }, reason);
  // An exit.
  if (d === "propose") return propose(db, seatId, potId, "request_exit", { part: args.part ?? "full", side: m.side }, reason);
  const pre = power === "fullExit" ? m.exitFull : m.exitPartial;
  if (!pre) throw fail("no exit was signed in advance for this", 409);
  const pots = potsAddress();
  const data = encodeFunctionData({ abi: potsAbi, functionName: "requestExitFor", args: [BigInt(potId), m.side, BigInt(pre.notional), BigInt(pre.deadline), pre.sig] });
  const ref = `pot-${potId}`;
  const res = await sendRelayCalls(db, "pot_forward", [{ ...memoCall(pots, data, ref, { v: 1, t: "pot", ref, pot: potId, why: `exit by the player's cat sitter: ${reason}`.slice(0, 120) }), label: "sitter exit" }]);
  if (!res.ok) throw fail(`the exit failed: ${res.error.slice(0, 160)}`, 502);
  // One use: the contract's nonce moved, so both exits signed in advance are spent.
  await db.query("UPDATE seat_pots SET exit_full = NULL, exit_partial = NULL WHERE pot_id = $1", [potId]);
  await syncPot(db, BigInt(potId)).catch(() => {});
  return { tx: res.tx, exit: args.part ?? "full", notional: pre.notional };
}

/** The player confirms or declines a proposal (the confirmed action itself is the player's own transaction). */
export async function decideProposal(db: Db, id: string, decision: "approved" | "declined") {
  const r = await db.query("UPDATE agent_proposals SET status = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id", [id, decision]);
  if (!r.length) throw fail("no such open proposal", 404);
  return { id, decision };
}

/** What the pot page shows: who minds or plays it, their actions with reasons, and open proposals. */
export async function agentInfoOf(db: Db, potId: string) {
  const sitter = (await db.query<{ label: string; powers: unknown; side: number }>(
    "SELECT s.label, p.powers, p.side FROM seat_pots p JOIN agent_seats s ON s.id = p.seat_id WHERE p.pot_id = $1 AND p.detached_at IS NULL",
    [potId],
  ))[0];
  const opponent = (await db.query<{ label: string }>("SELECT s.label FROM agent_pots p JOIN agent_seats s ON s.id = p.seat_id WHERE p.pot_id = $1", [potId]))[0];
  const actions = await db.query<{ action: string; ok: boolean; reason: string | null; at: string; label: string; detail: string | null }>(
    `SELECT a.action, a.ok, a.reason, a.created_at::text AS at, s.label, a.detail FROM agent_actions a JOIN agent_seats s ON s.id = a.seat_id
      WHERE a.pot_id = $1 AND a.action NOT IN ('read_pot', 'list_invites') ORDER BY a.created_at`,
    [potId],
  );
  const proposals = await db.query<{ id: string; action: string; args: unknown; reason: string; status: string; created_at: string }>(
    "SELECT id::text AS id, action, args, reason, status, created_at::text AS created_at FROM agent_proposals WHERE pot_id = $1 ORDER BY created_at DESC LIMIT 20",
    [potId],
  );
  return {
    sitter: sitter ? { label: sitter.label, side: Number(sitter.side), powers: typeof sitter.powers === "string" ? JSON.parse(sitter.powers) : sitter.powers } : null,
    opponent: opponent ? { label: opponent.label } : null,
    actions,
    proposals: proposals.map((p) => ({ ...p, args: typeof p.args === "string" ? JSON.parse(p.args) : p.args })),
  };
}

