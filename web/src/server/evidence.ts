import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { earlyDetail, getConfig, verifyPasskeyJoin, type Db } from "@honorcat/relay";
import { evidenceMessage } from "@/lib/evidence";

/**
 * Raw evidence (every sampler's bid, ask and sizes) is Gemini market data; its Market Data
 * Agreement restricts redistribution. Until Gemini answers, public pages show only the evidence
 * hash and computed values, and the raw records go to the pot's funder and recipients after one
 * signature. The stored records and their hashes do not change.
 */

type Detail = NonNullable<Awaited<ReturnType<typeof earlyDetail>>>;

const SESSION_MS = 60 * 60_000;

function key(): Buffer {
  // Derived from an existing server secret: no extra configuration, and rotating it ends all sessions.
  const base = getConfig().adminToken ?? process.env.CRON_SECRET;
  if (!base) throw Object.assign(new Error("evidence sessions are not configured on this server"), { status: 503 });
  return createHmac("sha256", base).update("honorcat-evidence-session/1").digest();
}

const mac = (id: string, account: string, exp: number) => createHmac("sha256", key()).update(`${id}|${account.toLowerCase()}|${exp}`).digest("hex");

/** Who may see a pot's raw evidence: its funder and the people who joined it. */
function members(d: Detail): Set<string> {
  return new Set([d.early.funder, ...d.recipients.map((r) => r.account)].map((a) => a.toLowerCase()));
}

export type SessionProof = { account: Address; issuedAt: string } & ({ signature: Hex } | { passkey: Parameters<typeof verifyPasskeyJoin>[3] });

/** Checks a fresh signed request from a member and returns a session token valid for one hour. */
export async function issueSession(db: Db, id: string, proof: SessionProof) {
  const d = await earlyDetail(db, id);
  if (!d) throw Object.assign(new Error("early payout not found"), { status: 404 });
  const issued = Date.parse(proof.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(proof.account);
  const message = evidenceMessage(id, account, proof.issuedAt);
  if ("signature" in proof) {
    if (!(await verifyMessage({ address: account, message, signature: proof.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, proof.passkey);
  }
  if (!members(d).has(account.toLowerCase()))
    throw Object.assign(new Error("only this payout’s funder and the people who joined it can see the raw readings"), { status: 403 });
  const exp = Date.now() + SESSION_MS;
  return { token: `${account}.${exp}.${mac(id, account, exp)}`, account, expiresAt: exp };
}

/** The member a valid token was issued to, or null. */
export function checkSession(id: string, token: string | null): Address | null {
  if (!token) return null;
  const [account, expS, sig] = token.split(".");
  const exp = Number(expS);
  if (!account || !sig || !Number.isFinite(exp) || exp < Date.now()) return null;
  const want = Buffer.from(mac(id, account, exp), "hex");
  const got = Buffer.from(sig, "hex");
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  return getAddress(account);
}

/* ------------------------------------------------------------------ the public view */

type RawRecord = { samples?: unknown[] } & Record<string, unknown>;

/** A signer's record without the raw readings: rule, window, average, counts, decision. */
function summary(record: Record<string, unknown>) {
  const { samples, ...rest } = record as RawRecord;
  return { ...rest, sampleCount: Array.isArray(samples) ? samples.length : 0 };
}

/**
 * The chart series for the public: midpoints averaged across samplers per 5-second bucket. Computed
 * values only; the per-sampler readings stay with the members.
 */
function averagedSamples(samples: Detail["samples"]) {
  const BUCKET = 5000;
  const by = new Map<number, { sum: number; n: number; statuses: number[] }>();
  for (const s of samples) {
    const k = Math.floor(s.t / BUCKET) * BUCKET;
    const b = by.get(k) ?? { sum: 0, n: 0, statuses: [] };
    if (s.status === 0 && s.mid !== null) {
      b.sum += s.mid;
      b.n += 1;
    }
    b.statuses.push(s.status);
    by.set(k, b);
  }
  return [...by.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, b]) => ({ signer: "average", t: t + BUCKET / 2, mid: b.n ? b.sum / b.n : null, status: b.n ? 0 : (b.statuses[0] ?? 1) }));
}

export function publicDetail(d: Detail) {
  return {
    ...d,
    signatures: d.signatures.map((s) => ({ ...s, record: s.record ? summary(s.record as Record<string, unknown>) : null })),
    samples: averagedSamples(d.samples),
    evidence: "summary" as const,
  };
}
