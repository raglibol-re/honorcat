import { encodeFunctionData, hashTypedData, type Hex } from "viem";
import { guaranteeBookAbi, verdictVaultAbi } from "./abi";
import { publicClient, resolverAccount } from "./chain";
import { getCondition, type Condition } from "./conditions";
import { getConfig } from "./config";
import type { Db } from "./db";
import { memoCall, type MemoBody } from "./memo";
import { resolutionDomain, resolutionTypes, signResolution } from "./signer";
import { GeminiSource } from "./sources/gemini";
import type { ResultSource } from "./sources/types";
import { sendRelayCalls, type RelayCall } from "./txs";

const MAX_ATTEMPTS = 5;

type OpenPot = { pot_id: string; condition_id: Hex; deadline: string; total: string };

export type ActionReport = {
  potId: string;
  action: "resolve" | "expire" | "refunds";
  outcome?: boolean;
  tx?: Hex;
  result: string;
};

let graceCache: bigint | undefined;
async function gracePeriod(): Promise<bigint> {
  graceCache ??= await publicClient().readContract({
    address: getConfig().vault,
    abi: verdictVaultAbi,
    functionName: "gracePeriod",
  });
  return graceCache;
}

async function record(
  db: Db,
  potId: string,
  action: string,
  fields: {
    outcome?: boolean | null;
    tx?: string | null;
    status: string;
    error?: string | null;
    attempt?: boolean;
    signature?: string;
    digest?: string;
    reason?: string;
    seen?: boolean;
  },
) {
  await db.query(
    `INSERT INTO resolutions (pot_id, action, outcome, tx_hash, status, attempts, last_error, signature, digest, reason, outcome_seen_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CASE WHEN $11 THEN now() END, now())
     ON CONFLICT (pot_id) DO UPDATE SET action = EXCLUDED.action, outcome = EXCLUDED.outcome,
       tx_hash = COALESCE(EXCLUDED.tx_hash, resolutions.tx_hash), status = EXCLUDED.status,
       attempts = resolutions.attempts + $6, last_error = EXCLUDED.last_error,
       signature = COALESCE(EXCLUDED.signature, resolutions.signature),
       digest = COALESCE(EXCLUDED.digest, resolutions.digest),
       reason = COALESCE(EXCLUDED.reason, resolutions.reason),
       outcome_seen_at = COALESCE(resolutions.outcome_seen_at, EXCLUDED.outcome_seen_at),
       updated_at = now()`,
    [
      potId,
      action,
      fields.outcome ?? null,
      fields.tx ?? null,
      fields.status,
      fields.attempt ? 1 : 0,
      fields.error ?? null,
      fields.signature ?? null,
      fields.digest ?? null,
      fields.reason ?? null,
      Boolean(fields.seen),
    ],
  );
}

async function attempts(db: Db, potId: string): Promise<number> {
  const rows = await db.query<{ attempts: number }>("SELECT attempts FROM resolutions WHERE pot_id = $1", [potId]);
  return rows[0]?.attempts ?? 0;
}

type GuaranteeRow = { id: string; gid: string | null; refund: string; promise: string; side: string };
async function guaranteeOf(db: Db, potId: string): Promise<GuaranteeRow | null> {
  const r = await db.query<GuaranteeRow>(
    "SELECT id, gid::text AS gid, refund::text AS refund, promise, side FROM guarantees WHERE pot_id = $1",
    [potId],
  );
  return r[0] ?? null;
}

/** A plain-language reason for the memo, from the source's own data where possible. */
async function reasonFor(condition: Condition, outcome: boolean, sources: Record<string, ResultSource>) {
  const base = { src: condition.source, mkt: condition.key } as const;
  const src = sources[condition.source];
  if (src instanceof GeminiSource) {
    const c = await src.contractFor(condition.key).catch(() => null);
    if (c) {
      const side = c.contract.resolutionSide === "yes" ? "YES" : "NO";
      return {
        ...base,
        res: side as "YES" | "NO",
        why: `Gemini settled "${c.contract.label ?? c.contract.ticker}" ${side} for "${c.event.title ?? c.event.ticker}"`,
      };
    }
  }
  return { ...base, why: `${condition.source} reported the condition as ${outcome ? "met" : "not met"}` };
}

const usdc = (v: string | bigint) => (Number(BigInt(v)) / 1e6).toFixed(2);

/**
 * One relay step for settlement. For every open, funded pot this relay resolves: ask its source
 * and, once the outcome is known, sign an EIP-712 resolution. Pots past `deadline + grace` are
 * expired instead. Guarantee pots that resolve positively also get their customer refunds
 * (GuaranteeBook.payout) in the same transaction.
 *
 * Everything due is sent as ONE transaction through Arc's Multicall3From, each call wrapped in
 * an Arc Memo carrying the reference and the reason, so the ledger shows why money moved.
 */
export async function processOpenPots(db: Db, sources: Record<string, ResultSource>): Promise<ActionReport[]> {
  const cfg = getConfig();
  const me = resolverAccount().address.toLowerCase();
  const grace = await gracePeriod();
  const now = BigInt(Math.floor(Date.now() / 1000));
  const book = cfg.guarantees?.book ?? null;

  const pots = await db.query<OpenPot>(
    `SELECT p.pot_id::text AS pot_id, p.condition_id, p.deadline::text AS deadline, p.total
     FROM vault_pots p LEFT JOIN resolutions r ON r.pot_id = p.pot_id
     WHERE p.status = 'open' AND lower(p.resolver) = $1
       AND (r.status IS NULL OR r.status NOT IN ('confirmed', 'already_settled'))
     ORDER BY p.pot_id`,
    [me],
  );

  type Planned = { call: RelayCall; potId: string; action: ActionReport["action"]; outcome?: boolean };
  const planned: Planned[] = [];
  const reports: ActionReport[] = [];

  for (const pot of pots) {
    if ((await attempts(db, pot.pot_id)) >= MAX_ATTEMPTS) continue;
    const closesAt = BigInt(pot.deadline) + grace;
    const g = await guaranteeOf(db, pot.pot_id);
    const ref = g ? `guarantee-${g.id}` : `pot-${pot.pot_id}`;

    if (now > closesAt) {
      if (!cfg.autoExpire) continue;
      const data = encodeFunctionData({ abi: verdictVaultAbi, functionName: "expire", args: [BigInt(pot.pot_id)] });
      const body: MemoBody = { v: 1, t: "expire", ref, pot: pot.pot_id, why: "No result before the deadline; the full amount went back to the funder" };
      planned.push({ call: { ...memoCall(cfg.vault, data, ref, body), potIds: [pot.pot_id], label: `expire ${pot.pot_id}` }, potId: pot.pot_id, action: "expire" });
      continue;
    }

    const condition = await getCondition(db, pot.condition_id);
    if (!condition) continue; // not a condition this relay knows about
    const source = sources[condition.source];
    if (!source) continue;

    let outcome: boolean | null;
    try {
      outcome = await source.getOutcome(pot.condition_id);
    } catch (err) {
      reports.push({ potId: pot.pot_id, action: "resolve", result: `source error: ${(err as Error).message}` });
      continue;
    }
    if (outcome === null) continue;
    if (pot.total === "0") continue; // contract rejects unfunded pots; wait for funding or expiry

    const message = { potId: BigInt(pot.pot_id), conditionId: pot.condition_id, outcome };
    const signature = await signResolution(resolverAccount(), { chainId: cfg.chainId, vault: cfg.vault, ...message });
    const digest = hashTypedData({
      domain: resolutionDomain(cfg.chainId, cfg.vault),
      types: resolutionTypes,
      primaryType: "Resolution",
      message,
    });
    const reason = await reasonFor(condition, outcome, sources);
    await record(db, pot.pot_id, "resolve", { outcome, status: "signed", signature, digest, reason: reason.why, seen: true });

    const data = encodeFunctionData({ abi: verdictVaultAbi, functionName: "resolve", args: [message.potId, outcome, signature] });
    const body: MemoBody = { v: 1, t: outcome ? "payout" : "refund", ref, pot: pot.pot_id, ...reason };
    planned.push({ call: { ...memoCall(cfg.vault, data, ref, body), potIds: [pot.pot_id], label: `resolve ${pot.pot_id}` }, potId: pot.pot_id, action: "resolve", outcome });

    // Guarantee refunds in the same transaction, right after the vault pays the book.
    if (outcome && g?.gid && book) {
      const payout = encodeFunctionData({ abi: guaranteeBookAbi, functionName: "payout", args: [BigInt(g.gid), 50n] });
      const rb: MemoBody = { v: 1, t: "refunds", ref, pot: pot.pot_id, why: `Refund of ${usdc(g.refund)} USDC each: ${reason.why}` };
      planned.push({ call: { ...memoCall(book, payout, ref, rb), potIds: [pot.pot_id], label: `refunds ${g.id}` }, potId: pot.pot_id, action: "refunds", outcome });
    }
  }

  // Guarantees whose pot already resolved positively but whose refunds are not complete
  // (e.g. a previous payout call failed): retry the payout.
  if (book) {
    const pending = await db.query<{ id: string; gid: string; pot_id: string; refund: string }>(
      `SELECT g.id, g.gid::text AS gid, g.pot_id::text AS pot_id, g.refund::text AS refund
       FROM guarantees g JOIN vault_pots p ON p.pot_id = g.pot_id
       WHERE g.gid IS NOT NULL AND p.status = 'resolved' AND p.outcome = true`,
    );
    for (const g of pending) {
      if (planned.some((x) => x.potId === g.pot_id)) continue;
      const state = await publicClient().readContract({ address: book, abi: guaranteeBookAbi, functionName: "getGuarantee", args: [BigInt(g.gid)] });
      if (state.settled) continue;
      const ref = `guarantee-${g.id}`;
      const reason = (await db.query<{ reason: string | null }>("SELECT reason FROM resolutions WHERE pot_id = $1", [g.pot_id]))[0]?.reason;
      const payout = encodeFunctionData({ abi: guaranteeBookAbi, functionName: "payout", args: [BigInt(g.gid), 50n] });
      const rb: MemoBody = { v: 1, t: "refunds", ref, pot: g.pot_id, why: `Refund of ${usdc(g.refund)} USDC each${reason ? `: ${reason}` : ""}` };
      planned.push({ call: { ...memoCall(book, payout, ref, rb), potIds: [g.pot_id], label: `refunds ${g.id}` }, potId: g.pot_id, action: "refunds", outcome: true });
    }
  }

  if (planned.length === 0) return reports;

  const res = await sendRelayCalls(db, planned.length > 1 ? "settle_batch" : planned[0]!.action === "refunds" ? "guarantee_refunds" : planned[0]!.action, planned.map((p) => p.call));
  const droppedLabels = new Map(res.dropped.map((d) => [d.call.label, d.error]));
  for (const p of planned) {
    const err = droppedLabels.get(p.call.label);
    if (p.action === "refunds") {
      reports.push({ potId: p.potId, action: "refunds", tx: res.ok && !err ? res.tx : undefined, result: err ? `error: ${err}` : res.ok ? "confirmed" : `error: ${res.error}` });
      continue;
    }
    if (err === "PotNotOpen") {
      // Settled by someone else (or by an earlier attempt we lost track of); the indexer catches up.
      await record(db, p.potId, p.action, { outcome: p.outcome, status: "already_settled" });
      reports.push({ potId: p.potId, action: p.action, outcome: p.outcome, result: "already_settled" });
    } else if (err || !res.ok) {
      const e = err ?? (res.ok ? "unknown" : res.error);
      await record(db, p.potId, p.action, { outcome: p.outcome, tx: res.tx, status: "error", error: e, attempt: true });
      reports.push({ potId: p.potId, action: p.action, outcome: p.outcome, tx: res.tx, result: `error: ${e}` });
    } else {
      await record(db, p.potId, p.action, { outcome: p.outcome, tx: res.tx, status: "confirmed", attempt: true });
      reports.push({ potId: p.potId, action: p.action, outcome: p.outcome, tx: res.tx, result: "confirmed" });
    }
  }
  return reports;
}
