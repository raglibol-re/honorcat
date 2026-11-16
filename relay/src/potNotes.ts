import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";

/**
 * After a pot ends, each side can say "Well played" and offer a rematch on a new market. A note is
 * signed by the player (wallet signature, ERC-1271 included, or a passkey assertion) and accepted
 * only from an account that held a side of this pot. A rematch is a friend draft (drafts.ts) whose
 * guest seat is reserved for the other player. Notes move no money and authorise nothing.
 */
export type NoteKind = "well_played" | "rematch";
const ENDED = [5, 6, 7]; // Divided, Settled, Expired

export const noteMessage = (potId: string, kind: NoteKind, account: string, issuedAt: string) =>
  `HonorCat: ${kind === "well_played" ? '"Well played"' : "a rematch"} on pot ${potId}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

/** Every account that held a side of this pot at some point (from the contract's Transfer events). */
export async function playersOf(db: Db, potId: string): Promise<string[]> {
  const rows = await db.query<{ to: string }>(
    "SELECT DISTINCT lower(args->>'to') AS to FROM pot_events WHERE pot_id = $1 AND event_name = 'Transfer' AND args->>'to' IS NOT NULL",
    [potId],
  );
  return rows.map((r) => r.to).filter((a) => a !== "0x0000000000000000000000000000000000000000");
}

export async function addNote(
  db: Db,
  input: { potId: string; account: Address; kind: NoteKind; draftId?: string | null; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  const pot = (await db.query<{ state: number }>("SELECT state FROM pots WHERE pot_id = $1", [input.potId]))[0];
  if (!pot) throw Object.assign(new Error("no such pot"), { status: 404 });
  if (!ENDED.includes(Number(pot.state))) throw Object.assign(new Error("notes are for pots that have ended"), { status: 409 });
  const players = await playersOf(db, input.potId);
  if (!players.includes(account.toLowerCase())) throw Object.assign(new Error("only the players of this pot can do that"), { status: 403 });
  const message = noteMessage(input.potId, input.kind, account, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, input.passkey);
  }
  let draftId: string | null = null;
  if (input.kind === "rematch") {
    if (!input.draftId) throw Object.assign(new Error("a rematch needs a new draft"), { status: 400 });
    const d = (await db.query<{ data: Record<string, unknown> | string }>("SELECT data FROM pot_drafts WHERE id = $1", [input.draftId]))[0];
    if (!d) throw Object.assign(new Error("no such draft"), { status: 404 });
    const data = (typeof d.data === "string" ? JSON.parse(d.data) : d.data) as { host?: { account: string } | null; reservedFor?: string | null };
    if (!data.host || getAddress(data.host.account) !== account) throw Object.assign(new Error("the rematch draft must be yours"), { status: 403 });
    const opponent = players.find((p) => p !== account.toLowerCase()) ?? null;
    data.reservedFor = opponent;
    await db.query("UPDATE pot_drafts SET data = $2, updated_at = now() WHERE id = $1", [input.draftId, JSON.stringify(data)]);
    draftId = input.draftId;
  }
  await db.query(
    `INSERT INTO pot_notes (pot_id, account, kind, draft_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (pot_id, account, kind) DO UPDATE SET draft_id = EXCLUDED.draft_id, created_at = now()`,
    [input.potId, account.toLowerCase(), input.kind, draftId],
  );
  return notesOf(db, input.potId);
}

export async function notesOf(db: Db, potId: string) {
  return db.query<{ account: string; kind: NoteKind; draft_id: string | null; created_at: string }>(
    "SELECT account, kind, draft_id, created_at::text AS created_at FROM pot_notes WHERE pot_id = $1 ORDER BY created_at",
    [potId],
  );
}
