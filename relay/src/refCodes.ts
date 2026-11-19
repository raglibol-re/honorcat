import { keccak256, toBytes } from "viem";
import type { Db } from "./db";

/**
 * Invite links carry a short code, never an address: the code is the first 8 characters (base 36)
 * of a hash of the account, stored so it can be looked up. Old links with ?ref=0x… still work.
 */
export function refCodeFor(account: string): string {
  const h = BigInt(keccak256(toBytes(`honorcat-ref:${account.toLowerCase()}`)));
  return h.toString(36).slice(0, 8);
}

export async function myRefCode(db: Db, account: string) {
  const code = refCodeFor(account);
  await db.query("INSERT INTO ref_codes (code, account) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING", [code, account.toLowerCase()]);
  return code;
}

export async function accountOfRef(db: Db, code: string): Promise<string | null> {
  if (!/^[0-9a-z]{6,12}$/.test(code)) return null;
  return (await db.query<{ account: string }>("SELECT account FROM ref_codes WHERE code = $1", [code]))[0]?.account ?? null;
}
