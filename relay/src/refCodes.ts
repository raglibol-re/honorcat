import { keccak256, toBytes } from "viem";
import type { Db } from "./db";

/**
 * Invite links carry a short code, never an address: the code is the first 8 characters (base 36)
 * of a hash of the account, stored so it can be looked up. Old links with ?ref=0x… still work.
 */
export function refCodeFor(account: string, len = 8): string {
  const h = BigInt(keccak256(toBytes(`honorcat-ref:${account.toLowerCase()}`)));
  return h.toString(36).slice(0, len);
}

export async function myRefCode(db: Db, account: string) {
  const a = account.toLowerCase();
  const had = (await db.query<{ code: string }>("SELECT code FROM ref_codes WHERE account = $1 ORDER BY length(code) LIMIT 1", [a]))[0];
  if (had) return had.code;
  // 8 characters, or longer if another account already holds that code: a code names one account only.
  for (const len of [8, 12, 16]) {
    const code = refCodeFor(a, len);
    const r = await db.query("INSERT INTO ref_codes (code, account) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING code", [code, a]);
    if (r.length) return code;
  }
  throw Object.assign(new Error("could not make an invite code"), { status: 500 });
}

export async function accountOfRef(db: Db, code: string): Promise<string | null> {
  if (!/^[0-9a-z]{6,16}$/.test(code)) return null;
  return (await db.query<{ account: string }>("SELECT account FROM ref_codes WHERE code = $1", [code]))[0]?.account ?? null;
}
