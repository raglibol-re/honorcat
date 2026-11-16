import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, type Address, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { getConfig, publicClient, verifyPasskeyJoin, type Db } from "@honorcat/relay";
import { potEvidenceStatement } from "@/lib/evidence";

/**
 * Raw readings (each sampler's bid, ask and sizes) are Gemini market data, which its Market Data
 * Agreement restricts. Public pages show evidence hashes and computed values; the raw records go
 * to the pot's sides (anyone who has held a side token of it) after one signature.
 */
const SESSION_MS = 60 * 60_000;

function key(): Buffer {
  const base = getConfig().adminToken ?? process.env.CRON_SECRET;
  if (!base) throw Object.assign(new Error("evidence sessions are not configured on this server"), { status: 503 });
  return createHmac("sha256", base).update("honorcat-pot-evidence/1").digest();
}
const mac = (id: string, account: string, exp: number) => createHmac("sha256", key()).update(`pot|${id}|${account.toLowerCase()}|${exp}`).digest("hex");

/** Everyone who has held a side of this pot, from the pot's Transfer events and its current owners. */
async function sides(db: Db, potId: string): Promise<Set<string>> {
  const rows = await db.query<{ to: string }>(
    "SELECT lower(args->>'to') AS to FROM pot_events WHERE event_name = 'Transfer' AND ((args->>'tokenId')::numeric / 2)::bigint = $1::bigint",
    [potId],
  );
  const owners = await db.query<{ yes_owner: string | null; no_owner: string | null }>("SELECT yes_owner, no_owner FROM pots WHERE pot_id = $1", [potId]);
  const s = new Set(rows.map((r) => r.to));
  for (const o of owners) [o.yes_owner, o.no_owner].forEach((a) => a && s.add(a.toLowerCase()));
  s.delete("0x0000000000000000000000000000000000000000");
  return s;
}

export type PotSessionProof = { account: Address; message: string } & ({ signature: Hex } | { passkey: Parameters<typeof verifyPasskeyJoin>[3] });

/**
 * Checks a Sign-In with Ethereum (EIP-4361) message: for this site (the host the request came to),
 * this account, chain and pot, issued in the last 10 minutes and not expired.
 */
function checkSiwe(message: string, account: Address, potId: string, host: string) {
  const m = parseSiweMessage(message);
  const issued = m.issuedAt ? m.issuedAt.getTime() : NaN;
  const ok =
    validateSiweMessage({ message: m, address: account, domain: host, time: new Date() }) &&
    m.chainId === 5042002 &&
    m.statement === potEvidenceStatement(potId) &&
    Number.isFinite(issued) &&
    Math.abs(Date.now() - issued) <= 10 * 60_000;
  if (!ok) throw Object.assign(new Error("the sign-in request is not for this site, account or pot, or is too old; sign again"), { status: 401 });
}

export async function issuePotSession(db: Db, potId: string, proof: PotSessionProof, host: string) {
  const account = getAddress(proof.account);
  const message = proof.message;
  checkSiwe(message, account, potId, host);
  if ("signature" in proof) {
    // EOAs and smart-contract wallets (ERC-1271, ERC-6492) alike.
    if (!(await publicClient().verifyMessage({ address: account, message, signature: proof.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, proof.passkey);
  }
  if (!(await sides(db, potId)).has(account.toLowerCase())) throw Object.assign(new Error("only the sides of this pot can see the raw readings"), { status: 403 });
  const exp = Date.now() + SESSION_MS;
  return { token: `${account}.${exp}.${mac(potId, account, exp)}`, account, expiresAt: exp };
}

export function checkPotSession(potId: string, token: string | null): Address | null {
  if (!token) return null;
  const [account, expS, sig] = token.split(".");
  const exp = Number(expS);
  if (!account || !sig || !Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(mac(potId, account, exp), "hex");
  const got = Buffer.from(sig, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return getAddress(account);
}

/** Every sampler's full evidence record for every window of the pot (raw readings included). */
export async function rawRecords(db: Db, potId: string) {
  return db.query<{ request_id: string; signer: string; evidence_hash: string; record: unknown; signature: string }>(
    `SELECT a.request_id, a.signer, a.evidence_hash, a.record, a.signature
       FROM att_averages a JOIN att_requests r ON r.id = a.request_id
      WHERE r.pot_id = $1 ORDER BY r.created_at, a.signer`,
    [potId],
  );
}
