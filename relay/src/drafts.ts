import { createHash, randomBytes } from "node:crypto";
import { getAddress, type Address } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { potsAbi } from "./potsAbi";
import { potsAddress, syncPot } from "./pots";

/**
 * Pots started together by two friends: a shared draft both edit (market, size, who takes YES),
 * then the host opens the pot and the guest puts in the other side, each with one confirmation.
 * The starting split is the market's 30-second average after the guest's request, as for any join.
 *
 * A draft is only coordination: it moves no money. Money moves only by each person's own signature.
 * Each seat gets a secret token on sitting down; actions on a seat need it (kept in that browser).
 */
export type Seat = { account: string; token: string; kind: "passkey" | "wallet" } | null;
export type DraftData = {
  host: Seat;
  guest: Seat;
  hostSide: 0 | 1; // the host's side; the guest takes the other
  symbol: string | null; // Gemini instrument
  label: string | null; // "event: contract", for the page
  notional: string; // USDC base units
  graceDays: number;
  version: number; // bumps on every change of terms
  guestAgreed: number | null; // the version the guest agreed to
  potId: string | null;
  status: "open" | "created" | "joined";
  /** A rematch: only this account may take the guest seat (potNotes.ts). */
  reservedFor?: string | null;
};

export const DRAFT_TOLERANCE = 50_000; // the widest band (5 points), so the friend's join rarely fails
const MAX_NOTIONAL = 25_000_000n;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

function publicView(id: string, d: DraftData, created_at: string) {
  const seat = (s: Seat) => (s ? { account: s.account, kind: s.kind } : null);
  return { id, ...d, host: seat(d.host), guest: seat(d.guest), createdAt: created_at };
}

async function load(db: Db, id: string) {
  const r = (await db.query<{ data: DraftData | string; created_at: string }>("SELECT data, created_at FROM pot_drafts WHERE id = $1", [id]))[0];
  if (!r) throw Object.assign(new Error("no such draft"), { status: 404 });
  return { data: (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as DraftData, createdAt: r.created_at };
}

async function save(db: Db, id: string, d: DraftData) {
  await db.query("UPDATE pot_drafts SET data = $2, updated_at = now() WHERE id = $1", [id, JSON.stringify(d)]);
}

function seatOf(d: DraftData, token: string | undefined): "host" | "guest" | null {
  if (!token) return null;
  const h = hashToken(token);
  if (d.host?.token === h) return "host";
  if (d.guest?.token === h) return "guest";
  return null;
}

export async function createDraft(db: Db, input: { account: Address; kind: "passkey" | "wallet" }) {
  const id = randomBytes(6).toString("base64url");
  const token = randomBytes(18).toString("base64url");
  const d: DraftData = {
    host: { account: getAddress(input.account), token: hashToken(token), kind: input.kind },
    guest: null,
    hostSide: 0,
    symbol: null,
    label: null,
    notional: "5000000",
    graceDays: 3,
    version: 1,
    guestAgreed: null,
    potId: null,
    status: "open",
  };
  await db.query("INSERT INTO pot_drafts (id, data) VALUES ($1, $2)", [id, JSON.stringify(d)]);
  return { id, token };
}

export async function getDraft(db: Db, id: string) {
  const { data, createdAt } = await load(db, id);
  if (data.potId && data.status !== "joined") {
    // Has the guest's side been put in? (the pot left Open)
    const p = (await publicClient().readContract({ address: potsAddress(), abi: potsAbi, functionName: "pot", args: [BigInt(data.potId)] }).catch(() => null)) as { state: number } | null;
    if (p && Number(p.state) >= 2) {
      data.status = "joined";
      await save(db, id, data);
    }
  }
  return publicView(id, data, createdAt);
}

export type DraftAction =
  | { action: "sit"; account: Address; kind: "passkey" | "wallet" }
  | { action: "terms"; token: string; symbol?: string; label?: string; notional?: string; hostSide?: 0 | 1; graceDays?: number }
  | { action: "agree"; token: string; version: number }
  | { action: "created"; token: string; potId: string };

export async function actOnDraft(db: Db, id: string, a: DraftAction) {
  const { data: d, createdAt } = await load(db, id);
  if (a.action === "sit") {
    if (d.guest) throw Object.assign(new Error("both seats are taken"), { status: 409 });
    if (d.reservedFor && getAddress(a.account).toLowerCase() !== d.reservedFor.toLowerCase())
      throw Object.assign(new Error("this rematch is reserved for the other player of the last pot"), { status: 403 });
    if (d.host && getAddress(a.account) === getAddress(d.host.account)) throw Object.assign(new Error("that is the host's own account; open the link with your friend's"), { status: 409 });
    const token = randomBytes(18).toString("base64url");
    d.guest = { account: getAddress(a.account), token: hashToken(token), kind: a.kind };
    await save(db, id, d);
    return { token, draft: publicView(id, d, createdAt) };
  }
  const seat = seatOf(d, a.token);
  if (!seat) throw Object.assign(new Error("this browser does not hold a seat of this draft"), { status: 403 });
  if (a.action === "terms") {
    if (d.potId) throw Object.assign(new Error("the pot is already open"), { status: 409 });
    if (a.symbol !== undefined) {
      if (!/^GEMI-[A-Z0-9.-]+$/i.test(a.symbol)) throw Object.assign(new Error("not a Gemini instrument"), { status: 400 });
      d.symbol = a.symbol;
      d.label = (a.label ?? "").slice(0, 200) || null;
    }
    if (a.notional !== undefined) {
      const n = BigInt(a.notional);
      if (n <= 0n || n > MAX_NOTIONAL) throw Object.assign(new Error("pot size must be above 0 and at most $25"), { status: 400 });
      d.notional = n.toString();
    }
    if (a.hostSide !== undefined) d.hostSide = a.hostSide;
    if (a.graceDays !== undefined) d.graceDays = Math.max(1, Math.min(30, Math.round(a.graceDays)));
    d.version += 1;
    d.guestAgreed = null; // any change needs the guest's agreement again
  } else if (a.action === "agree") {
    if (seat !== "guest") throw Object.assign(new Error("only the friend agrees"), { status: 403 });
    if (a.version !== d.version) throw Object.assign(new Error("the terms just changed; look again"), { status: 409 });
    if (!d.symbol) throw Object.assign(new Error("pick a market first"), { status: 400 });
    d.guestAgreed = d.version;
  } else if (a.action === "created") {
    if (seat !== "host") throw Object.assign(new Error("only the host opens the pot"), { status: 403 });
    if (d.guestAgreed !== d.version) throw Object.assign(new Error("your friend has not agreed to these terms"), { status: 409 });
    // Check on-chain: the pot exists and the host holds the agreed side.
    const owner = await publicClient()
      .readContract({ address: potsAddress(), abi: potsAbi, functionName: "ownerOf", args: [BigInt(a.potId) * 2n + BigInt(d.hostSide)] })
      .catch(() => null);
    if (!owner || getAddress(owner as Address) !== getAddress(d.host!.account)) throw Object.assign(new Error("that pot is not the host's on the agreed side"), { status: 400 });
    d.potId = a.potId;
    d.status = "created";
    await syncPot(db, BigInt(a.potId)).catch(() => {});
  }
  await save(db, id, d);
  return { draft: publicView(id, d, createdAt) };
}
