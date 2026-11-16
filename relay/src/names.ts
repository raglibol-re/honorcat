import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { practiceAddress } from "./practice";

/**
 * Display names: what a side is called on the rope and in lists instead of its address. An account
 * sets its own name by signing it (wallet signature, ERC-1271 included, or a passkey assertion).
 * Names are public and not unique; addresses stay visible in the technical details.
 */
export const nameMessage = (account: string, name: string, issuedAt: string) =>
  `HonorCat: call me "${name}" on HonorCat.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

export function cleanName(name: string): string {
  const n = name.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 24) throw Object.assign(new Error("a name has 2 to 24 characters"), { status: 400 });
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(n)) throw Object.assign(new Error("letters, digits, spaces and . _ ' - only"), { status: 400 });
  if (/practice cat|honorcat/i.test(n)) throw Object.assign(new Error("that name is reserved"), { status: 400 });
  return n;
}

export async function setName(
  db: Db,
  input: { account: Address; name: string; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  const name = cleanName(input.name);
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  const message = nameMessage(account, input.name, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, input.passkey);
  }
  await db.query(
    "INSERT INTO display_names (account, name) VALUES ($1, $2) ON CONFLICT (account) DO UPDATE SET name = EXCLUDED.name, updated_at = now()",
    [account.toLowerCase(), name],
  );
  return { account, name };
}

/** Names for some accounts; the practice cat is always called that. */
export async function namesOf(db: Db, accounts: string[]): Promise<Record<string, string>> {
  const list = [...new Set(accounts.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))].slice(0, 50);
  const out: Record<string, string> = {};
  if (list.length) {
    const rows = await db.query<{ account: string; name: string }>("SELECT account, name FROM display_names WHERE account = ANY($1::text[])", [list]);
    for (const r of rows) out[r.account] = r.name;
  }
  try {
    out[practiceAddress().toLowerCase()] = "Practice cat";
  } catch {
    /* no relay key configured */
  }
  return out;
}
