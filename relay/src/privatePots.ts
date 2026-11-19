import { randomBytes } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { playersOf } from "./potNotes";

/**
 * Private pots: a player marks a pot private with a signed request; from then on only its players and
 * people with the link (which carries a key) see it, it is left out of every list, and leaderboards
 * never show its amounts. Display only: the pot itself is on a public chain like every other.
 */
export const privateMessage = (potId: string, account: string, issuedAt: string) =>
  `HonorCat: make pot ${potId} private.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

async function playersAll(db: Db, potId: string): Promise<string[]> {
  const row = (await db.query<{ yes_owner: string | null; no_owner: string | null; joiner: string | null }>("SELECT yes_owner, no_owner, data->>'joiner' AS joiner FROM pots WHERE pot_id = $1", [potId]))[0];
  const own = [row?.yes_owner, row?.no_owner, row?.joiner].filter((x): x is string => !!x && !/^0x0{40}$/i.test(x)).map((x) => x.toLowerCase());
  return [...new Set([...own, ...(await playersOf(db, potId))])];
}

export async function makePrivate(db: Db, input: { potId: string; account: Address; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion })) {
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  if (!(await playersAll(db, input.potId)).includes(account.toLowerCase())) throw Object.assign(new Error("only the players of this pot can make it private"), { status: 403 });
  const message = privateMessage(input.potId, account, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else await verifyPasskeyJoin(db, account, message, input.passkey);
  const key = randomBytes(8).toString("base64url");
  await db.query("INSERT INTO pot_private (pot_id, key, by_account) VALUES ($1, $2, $3) ON CONFLICT (pot_id) DO NOTHING", [input.potId, key, account.toLowerCase()]);
  return { key: (await keyOf(db, input.potId))! };
}

export async function keyOf(db: Db, potId: string): Promise<string | null> {
  return (await db.query<{ key: string }>("SELECT key FROM pot_private WHERE pot_id = $1", [potId]))[0]?.key ?? null;
}

/**
 * Whether a viewer may see a pot: public pots always; a private one only with its link's key. A
 * player who has no link proves they are a player with one signature (keyForPlayer) and gets the key.
 */
export async function maySee(db: Db, potId: string, viewer: { key?: string | null }) {
  const key = await keyOf(db, potId);
  if (!key) return { ok: true, private: false };
  if (viewer.key && viewer.key === key) return { ok: true, private: true, key };
  return { ok: false, private: true };
}

export const keyMessage = (potId: string, account: string, issuedAt: string) =>
  `HonorCat: show me the private link of pot ${potId}.
Account: ${getAddress(account)}
Issued: ${issuedAt}`;

/** A player's signed request for their private pot's link key. */
export async function keyForPlayer(db: Db, input: { potId: string; account: Address; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion })) {
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  if (!(await playersAll(db, input.potId)).includes(account.toLowerCase())) throw Object.assign(new Error("only the players of this pot can see it"), { status: 403 });
  const message = keyMessage(input.potId, account, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else await verifyPasskeyJoin(db, account, message, input.passkey);
  return { key: await keyOf(db, input.potId) };
}

/** Throws 403 unless the viewer may see the pot (every per-pot API route calls this). */
export async function assertMaySee(db: Db, potId: string, key: string | null | undefined) {
  const see = await maySee(db, potId, { key });
  if (!see.ok) throw Object.assign(new Error("this pot is private"), { status: 403 });
  return see;
}

/** SQL fragment: the pot (column `col`) is not private. */
export const NOT_PRIVATE = (col: string) => `NOT EXISTS (SELECT 1 FROM pot_private pv WHERE pv.pot_id = (${col})::text)`;
