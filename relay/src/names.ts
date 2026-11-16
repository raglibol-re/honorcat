import { englishDataset, englishRecommendedTransformers, RegExpMatcher } from "obscenity";
import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { practiceAddress } from "./practice";

/** The fur colours a player's cat can have (the web draws them; keep in step with web/src/lib/names.ts). */
export const FURS = ["black", "grey", "ginger", "cream", "brown", "white"] as const;
export type Fur = (typeof FURS)[number];

const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });

/**
 * Display names: what a side is called on the rope and in lists instead of its address. An account
 * sets its own name by signing it (wallet signature, ERC-1271 included, or a passkey assertion).
 * Names are public and not unique; addresses stay visible in the technical details.
 */
export const nameMessage = (account: string, name: string, issuedAt: string, fur?: string | null) =>
  `HonorCat: call me "${name}" on HonorCat.${fur ? `\nMy cat's fur: ${fur}` : ""}\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

export function cleanName(name: string): string {
  const n = name.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (n.length < 2 || n.length > 20) throw Object.assign(new Error("A name has 2 to 20 characters."), { status: 400 });
  if (!/^[\p{L}\p{N} ._'-]+$/u.test(n)) throw Object.assign(new Error("Use letters, digits, spaces and . _ ' - only."), { status: 400 });
  if (/practice cat|honorcat/i.test(n)) throw Object.assign(new Error("That name is reserved. Pick another one."), { status: 400 });
  // Also with the gaps closed, so "b i t c h" is caught too.
  if (profanity.hasMatch(n) || profanity.hasMatch(n.replace(/[\s._'-]+/g, ""))) throw Object.assign(new Error("That name is not allowed here. Pick another one."), { status: 400 });
  return n;
}

export async function setName(
  db: Db,
  input: { account: Address; name: string; issuedAt: string; fur?: string | null } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  const name = cleanName(input.name);
  const fur = input.fur ?? null;
  if (fur !== null && !(FURS as readonly string[]).includes(fur)) throw Object.assign(new Error("Pick one of the fur colours shown."), { status: 400 });
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  const message = nameMessage(account, input.name, input.issuedAt, fur);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, input.passkey);
  }
  await db.query(
    "INSERT INTO display_names (account, name, fur) VALUES ($1, $2, $3) ON CONFLICT (account) DO UPDATE SET name = EXCLUDED.name, fur = COALESCE(EXCLUDED.fur, display_names.fur), updated_at = now()",
    [account.toLowerCase(), name, fur],
  );
  return { account, name, fur };
}

/** Names for some accounts; the practice cat is always called that. */
export async function namesOf(db: Db, accounts: string[]): Promise<Record<string, string>> {
  return (await catsOf(db, accounts)).names;
}

/** Names and fur colours for some accounts; the practice cat is always the grey "Practice cat". */
export async function catsOf(db: Db, accounts: string[]): Promise<{ names: Record<string, string>; furs: Record<string, string> }> {
  const list = [...new Set(accounts.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))].slice(0, 50);
  const names: Record<string, string> = {};
  const furs: Record<string, string> = {};
  if (list.length) {
    const rows = await db.query<{ account: string; name: string; fur: string | null }>("SELECT account, name, fur FROM display_names WHERE account = ANY($1::text[])", [list]);
    for (const r of rows) {
      names[r.account] = r.name;
      if (r.fur) furs[r.account] = r.fur;
    }
  }
  try {
    const p = practiceAddress().toLowerCase();
    names[p] = "Practice cat";
    furs[p] = "grey";
  } catch {
    /* no relay key configured */
  }
  return { names, furs };
}
