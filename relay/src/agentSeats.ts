import { createHash, randomBytes } from "node:crypto";
import { encodeFunctionData, getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import { signTypedDataViaCircle } from "./circleWallet";
import type { Db } from "./db";
import { memoCall } from "./memo";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { potDetail, potsAddress, syncPot } from "./pots";
import { potsAbi } from "./potsAbi";
import { offerHandshake } from "./potsActions";
import { practiceAddress, practiceJoin } from "./practice";
import { mindedPot, sitterAct } from "./catSitter";
import { sendRelayCalls } from "./txs";

/**
 * Agent seats: a player lets an outside agent (their Grok Bot, through our MCP connector) hold the
 * other side of their own practice pots. The side is held by the relay's practice wallet; the agent
 * only chooses from a fixed list of actions, each checked here against the seat's limits and logged.
 * A seat is created and revoked by its player (signed), carries a secret token (only its hash is
 * stored), expires, and plays testnet practice pots only. Agent pots stay out of honor records.
 */
export const SEAT_ACTIONS = ["list_invites", "read_pot", "take_side", "set_net", "set_bowl", "request_exit", "offer_handshake", "accept_handshake"] as const;
export type SeatAction = (typeof SEAT_ACTIONS)[number];
export const SEAT_MAX_NOTIONAL = 2_000_000n; // $2 per pot, test money
export const SEAT_MAX_POTS = 10;
export const SEAT_LIFETIME_H = 24;

export type Seat = { id: string; account: string; label: string; maxNotional: bigint; maxPots: number; expiresAt: string; revokedAt: string | null; createdAt: string };
type SeatRow = { id: string; account: string; label: string; max_notional: string; max_pots: number; expires_at: string; revoked_at: string | null; created_at: string };
const toSeat = (r: SeatRow): Seat => ({ id: r.id, account: r.account, label: r.label, maxNotional: BigInt(r.max_notional), maxPots: Number(r.max_pots), expiresAt: r.expires_at, revokedAt: r.revoked_at, createdAt: r.created_at });
const hash = (t: string) => createHash("sha256").update(t).digest("hex");
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

export const seatMessage = (what: "create" | "revoke", account: string, ref: string, issuedAt: string) =>
  `HonorCat: ${what === "create" ? `let my agent "${ref}" play my practice pots` : `revoke agent seat ${ref}`}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

async function verify(db: Db, account: Address, message: string, issuedAt: string, proof: { signature: Hex } | { passkey: WebAuthnAssertion }) {
  const t = Date.parse(issuedAt);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 10 * 60_000) throw fail("the signed request is too old; sign again", 401);
  if ("signature" in proof) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: proof.signature }))) throw fail("signature does not match the account", 401);
  } else await verifyPasskeyJoin(db, account, message, proof.passkey);
}

/** A signed-in player creates a seat; the token is returned once and only its hash is kept. */
export async function createSeat(
  db: Db,
  input: { account: Address; label: string; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  const label = input.label.replace(/\s+/g, " ").trim().slice(0, 40) || "My Grok Bot";
  await verify(db, input.account, seatMessage("create", input.account, label, input.issuedAt), input.issuedAt, input);
  const active = await db.query("SELECT 1 FROM agent_seats WHERE account = $1 AND revoked_at IS NULL AND expires_at > now()", [input.account.toLowerCase()]);
  if (active.length >= 3) throw fail("you have three active agent seats; revoke one first", 409);
  const id = randomBytes(6).toString("base64url");
  const token = `hcs_${randomBytes(24).toString("base64url")}`;
  await db.query(
    `INSERT INTO agent_seats (id, account, label, token_hash, max_notional, max_pots, expires_at) VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' hours')::interval)`,
    [id, input.account.toLowerCase(), label, hash(token), SEAT_MAX_NOTIONAL.toString(), SEAT_MAX_POTS, String(SEAT_LIFETIME_H)],
  );
  return { id, token, label, expiresInHours: SEAT_LIFETIME_H };
}

export async function revokeSeat(db: Db, input: { account: Address; seatId: string; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion })) {
  await verify(db, input.account, seatMessage("revoke", input.account, input.seatId, input.issuedAt), input.issuedAt, input);
  const r = await db.query("UPDATE agent_seats SET revoked_at = now() WHERE id = $1 AND account = $2 AND revoked_at IS NULL RETURNING id", [input.seatId, input.account.toLowerCase()]);
  if (!r.length) throw fail("no such active seat of yours", 404);
  return { revoked: input.seatId };
}

/** The player's seats with what each did (public facts; never the token). */
export async function seatsOf(db: Db, account: string) {
  const rows = await db.query<SeatRow & { pots: string; actions: string }>(
    `SELECT s.*, (SELECT count(*) FROM agent_pots p WHERE p.seat_id = s.id)::text AS pots, (SELECT count(*) FROM agent_actions a WHERE a.seat_id = s.id)::text AS actions
       FROM agent_seats s WHERE s.account = $1 ORDER BY s.created_at DESC LIMIT 20`,
    [account.toLowerCase()],
  );
  return rows.map((r) => ({ ...toSeat(r), maxNotional: r.max_notional, pots: Number(r.pots), actions: Number(r.actions), active: !r.revoked_at && Date.parse(r.expires_at) > Date.now() }));
}

/** The seat behind a bearer token, only while it is neither revoked nor expired. */
export async function seatByToken(db: Db, token: string | null | undefined): Promise<Seat | null> {
  if (!token || !/^hcs_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  const r = (await db.query<SeatRow>("SELECT * FROM agent_seats WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()", [hash(token)]))[0];
  return r ? toSeat(r) : null;
}

/** The player marks an open practice pot of theirs for their agent (the "play against my Grok Bot" choice). */
export async function inviteAgent(db: Db, potId: string, account: string) {
  await db.query("INSERT INTO agent_invites (pot_id, account) VALUES ($1, $2) ON CONFLICT (pot_id) DO NOTHING", [potId, account.toLowerCase()]);
}

async function log(db: Db, seat: Seat, action: SeatAction, potId: string | null, ok: boolean, detail: string, reason: string | null) {
  await db.query("INSERT INTO agent_actions (seat_id, pot_id, action, ok, detail, reason) VALUES ($1,$2,$3,$4,$5,$6)", [seat.id, potId, action, ok, detail.slice(0, 300), reason]);
}

const MUTATING: SeatAction[] = ["take_side", "set_net", "set_bowl", "request_exit", "offer_handshake", "accept_handshake"];

/** Runs one seat action: re-checks the seat, checks the action list, logs the outcome either way. */
export async function seatAct(db: Db, seatId: string, action: string, args: { potId?: string; percent?: number; fraction?: number; part?: "full" | "partial"; reason?: string } = {}) {
  const fresh = (await db.query<SeatRow>("SELECT * FROM agent_seats WHERE id = $1 AND revoked_at IS NULL AND expires_at > now()", [seatId]))[0];
  if (!fresh) throw fail("this agent seat was revoked or has expired", 401);
  const seat = toSeat(fresh);
  if (!(SEAT_ACTIONS as readonly string[]).includes(action)) throw fail(`"${action}" is not an action this seat may take`, 403);
  const a = action as SeatAction;
  // Every action that changes something carries the agent's own one-line reason, shown on the pot page.
  const reason = (args.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 140) || null;
  if (MUTATING.includes(a) && !reason) throw fail("give a one-line reason for this action");
  try {
    const minded = args.potId && /^\d+$/.test(args.potId) ? await mindedPot(db, seat.id, args.potId) : null;
    let out: unknown;
    if (minded && (a === "set_net" || a === "set_bowl" || a === "request_exit" || a === "accept_handshake"))
      out = await sitterAct(db, seat.id, args.potId!, a, { percent: args.percent, part: args.part ?? (args.fraction !== undefined && args.fraction < 1 ? "partial" : "full") }, reason!);
    else if (minded && a === "read_pot") {
      const d = await potDetail(db, args.potId!);
      out = { pot: d && { potId: d.potId, state: d.state, market: d.market, data: d.data, owners: d.owners, events: d.events }, minding: { side: minded.side, powers: minded.powers } };
    } else out = await run(db, seat, a, args);
    await log(db, seat, a, args.potId ?? null, true, JSON.stringify(out).slice(0, 200), reason);
    return out;
  } catch (e) {
    await log(db, seat, a, args.potId ?? null, false, (e as Error).message, reason);
    throw e;
  }
}

type PotLite = { state: number; notional: bigint; creatorSide: number; nonce: bigint; owners: { yes: string | null; no: string | null } };
async function potLite(potId: string): Promise<PotLite> {
  const c = publicClient();
  const p = (await c.readContract({ address: potsAddress(), abi: potsAbi, functionName: "pot", args: [BigInt(potId)] })) as unknown as { state: number; notional: bigint; creatorSide: number; nonce: bigint };
  const owner = async (side: number) => (await c.readContract({ address: potsAddress(), abi: potsAbi, functionName: "ownerOf", args: [BigInt(potId) * 2n + BigInt(side)] }).catch(() => null)) as string | null;
  return { state: Number(p.state), notional: p.notional, creatorSide: Number(p.creatorSide), nonce: p.nonce, owners: { yes: await owner(0), no: await owner(1) } };
}

/** The side this seat holds in `potId` (the relay wallet's side of one of its agent pots). */
async function heldSide(db: Db, seat: Seat, potId: string) {
  const mine = await db.query("SELECT 1 FROM agent_pots WHERE pot_id = $1 AND seat_id = $2", [potId, seat.id]);
  if (!mine.length) throw fail("this seat does not hold a side in that pot", 403);
  const p = await potLite(potId);
  const me = practiceAddress().toLowerCase();
  const side = p.owners.yes?.toLowerCase() === me ? 0 : p.owners.no?.toLowerCase() === me ? 1 : null;
  if (side === null) throw fail("the agent no longer holds a side in that pot", 409);
  return { p, side };
}

async function sendAsAgent(db: Db, potId: string, data: Hex, why: string) {
  const pots = potsAddress();
  const ref = `pot-${potId}`;
  const res = await sendRelayCalls(db, "pot_exec", [{ ...memoCall(pots, data, ref, { v: 1, t: "pot", ref, pot: potId, why: `${why} (an agent seat, test money)` }), label: why }], { atomic: true });
  if (!res.ok) throw fail(`the transaction failed: ${res.error.slice(0, 160)}`, 502);
  await syncPot(db, BigInt(potId)).catch(() => {});
  return res.tx;
}

async function run(db: Db, seat: Seat, a: SeatAction, args: { potId?: string; percent?: number; fraction?: number }) {
  const needPot = () => {
    if (!args.potId || !/^\d+$/.test(args.potId)) throw fail("give a pot id");
    return args.potId;
  };
  switch (a) {
    case "list_invites": {
      // The player's open pots marked for their agent, within the seat's size limit.
      const rows = await db.query<{ pot_id: string }>("SELECT pot_id::text AS pot_id FROM agent_invites WHERE account = $1 ORDER BY created_at DESC LIMIT 10", [seat.account]);
      const out = [];
      for (const r of rows) {
        const d = await potDetail(db, r.pot_id).catch(() => null);
        if (d && d.state === "Open" && BigInt(d.data.notional) <= seat.maxNotional) out.push({ potId: r.pot_id, market: d.market, notional: d.data.notional, creatorSide: d.data.creatorSide });
      }
      // And the player's own pots this seat minds as a cat sitter.
      const minded = await db.query<{ pot_id: string; side: number; powers: unknown }>(
        "SELECT pot_id::text AS pot_id, side, powers FROM seat_pots WHERE seat_id = $1 AND detached_at IS NULL ORDER BY created_at DESC LIMIT 10",
        [seat.id],
      );
      return { invites: out, minding: minded.map((m) => ({ potId: m.pot_id, side: Number(m.side), powers: typeof m.powers === "string" ? JSON.parse(m.powers) : m.powers })) };
    }
    case "read_pot": {
      const potId = needPot();
      const d = await potDetail(db, potId);
      if (!d) throw fail("no such pot", 404);
      const ok = (await db.query("SELECT 1 FROM agent_pots WHERE pot_id = $1 AND seat_id = $2 UNION SELECT 1 FROM agent_invites WHERE pot_id = $1 AND account = $3", [potId, seat.id, seat.account])).length > 0;
      if (!ok) throw fail("this seat may read only its player's invitations and its own pots", 403);
      return { pot: { potId: d.potId, state: d.state, market: d.market, data: d.data, owners: d.owners, events: d.events } };
    }
    case "take_side": {
      const potId = needPot();
      const inv = await db.query("SELECT 1 FROM agent_invites WHERE pot_id = $1 AND account = $2", [potId, seat.account]);
      if (!inv.length) throw fail("the player did not invite their agent to this pot", 403);
      const p = await potLite(potId);
      const creator = p.creatorSide === 0 ? p.owners.yes : p.owners.no;
      if (!creator || creator.toLowerCase() !== seat.account) throw fail("an agent plays only against its own player", 403);
      if (p.notional > seat.maxNotional) throw fail(`this seat plays pots up to $${Number(seat.maxNotional) / 1e6}`, 403);
      const n = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM agent_pots WHERE seat_id = $1", [seat.id]);
      if (Number(n[0]?.n ?? 0) >= seat.maxPots) throw fail(`this seat has played its ${seat.maxPots} pots`, 403);
      const r = await practiceJoin(db, potId);
      await db.query("INSERT INTO agent_pots (pot_id, seat_id) VALUES ($1, $2) ON CONFLICT DO NOTHING", [potId, seat.id]);
      return { joined: potId, tx: r.tx, side: 1 - p.creatorSide };
    }
    case "set_net":
    case "set_bowl": {
      const potId = needPot();
      const pct = Number(args.percent);
      if (!(pct > 0 && pct < 100)) throw fail("give a percentage between 0 and 100 for your own side");
      const { side } = await heldSide(db, seat, potId);
      const d = await potDetail(db, potId);
      const lv = (d?.data.levels?.[side] as { net: number; bowl: number } | null | undefined) ?? { net: 0, bowl: 0 };
      const ppm = Math.round(pct * 10_000);
      const net = a === "set_net" ? ppm : lv.net;
      const bowl = a === "set_bowl" ? ppm : lv.bowl;
      const tx = await sendAsAgent(db, potId, encodeFunctionData({ abi: potsAbi, functionName: "setLevels", args: [BigInt(potId), side, net, bowl] }), a === "set_net" ? `net at ${pct}%` : `bowl at ${pct}%`);
      return { tx, side, net, bowl };
    }
    case "request_exit": {
      const potId = needPot();
      const { p, side } = await heldSide(db, seat, potId);
      const fraction = args.fraction === undefined ? 1 : Number(args.fraction);
      if (!(fraction > 0 && fraction <= 1)) throw fail("fraction is between 0 and 1 (1 = the whole share)");
      const notional = fraction === 1 ? p.notional : (p.notional * BigInt(Math.round(fraction * 1000))) / 1000n;
      const tx = await sendAsAgent(db, potId, encodeFunctionData({ abi: potsAbi, functionName: "requestExit", args: [BigInt(potId), side, notional] }), "exit requested");
      return { tx, side, notional: notional.toString(), note: "Final: the exit price is the average of the next 30 seconds." };
    }
    case "offer_handshake":
    case "accept_handshake": {
      const potId = needPot();
      const { p, side } = await heldSide(db, seat, potId);
      if (p.state !== 3) throw fail("handshakes only while the pot is live", 409);
      let priceYes: number;
      let notional = p.notional;
      let deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      if (a === "accept_handshake") {
        const other = (await db.query<{ price_yes: number; notional: string; deadline: string }>(
          "SELECT price_yes, notional, deadline::text AS deadline FROM pot_handshakes WHERE pot_id = $1 AND pot_nonce = $2 AND side = $3 AND deadline > $4",
          [potId, p.nonce.toString(), 1 - side, Math.floor(Date.now() / 1000)],
        ))[0];
        if (!other) throw fail("the player has not offered a handshake", 409);
        priceYes = Number(other.price_yes);
        notional = BigInt(other.notional);
        deadline = BigInt(other.deadline);
      } else {
        const d = await potDetail(db, potId);
        const atts = ((d?.requests ?? []) as { payload?: { attestation?: { valid?: boolean; priceYes?: number } } }[]).map((r) => r.payload?.attestation).filter((x) => x?.valid);
        if (!atts[0]) throw fail("no measured price yet to shake hands at", 409);
        priceYes = Number(atts[0].priceYes);
      }
      const signature = await signTypedDataViaCircle({
        domain: { name: "HonorCatPots", version: "1", chainId: 5042002, verifyingContract: potsAddress() },
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          Handshake: [
            { name: "potId", type: "uint256" },
            { name: "priceYes", type: "uint32" },
            { name: "notional", type: "uint256" },
            { name: "potNonce", type: "uint64" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Handshake",
        message: { potId: potId, priceYes, notional: notional.toString(), potNonce: p.nonce.toString(), deadline: deadline.toString() },
      });
      const r = await offerHandshake(db, { potId, side: side as 0 | 1, priceYes, notional: notional.toString(), deadline: Number(deadline), signature });
      return { ...r, priceYes, notional: notional.toString() };
    }
  }
}

/** Counts for /how-it-is-built. */
export async function agentEvidence(db: Db) {
  const r = (await db.query<{ pots: string; actions: string; seats: string }>(
    "SELECT (SELECT count(*) FROM agent_pots)::text AS pots, (SELECT count(*) FROM agent_actions WHERE ok)::text AS actions, (SELECT count(*) FROM agent_seats)::text AS seats",
  ))[0];
  return { agentPots: Number(r?.pots ?? 0), agentActions: Number(r?.actions ?? 0), seats: Number(r?.seats ?? 0) };
}

/** The agent's actions in a pot, for "played by an agent" on the pot page. */
export async function agentActionsOf(db: Db, potId: string) {
  return db.query<{ action: string; ok: boolean; at: string; label: string }>(
    `SELECT a.action, a.ok, a.created_at::text AS at, s.label FROM agent_actions a JOIN agent_seats s ON s.id = a.seat_id
      WHERE a.pot_id = $1 AND a.action <> 'read_pot' ORDER BY a.created_at`,
    [potId],
  );
}

export const addressOfPractice = (): Address => practiceAddress();
