import { potRelayCost } from "./status";
import type { Db } from "./db";

/** Read models served by the REST API. Amounts are strings in USDC base units (6 decimals). */

export type PotDto = {
  potId: number;
  conditionId: string;
  creator: string;
  resolver: string;
  refundTo: string;
  deadline: number;
  payees: { address: string; shareBps: number }[];
  status: "open" | "resolved" | "expired";
  outcome: boolean | null;
  total: string;
  fundingCount: number;
  createdTx: string;
  createdTime: number | null;
  settledTx: string | null;
  settledTime: number | null;
  condition: { source: string; key: string; label: string | null } | null;
};

export type PaymentDto = {
  id: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  time: number | null;
  potId: number | null;
  kind: "payout" | "refund" | "payout_deferred" | "refund_deferred" | "claim";
  recipient: string;
  amount: string;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

type PotRow = Record<string, unknown> & { payees: string[]; shares_bps: number[] };

function toPot(r: PotRow): PotDto {
  return {
    potId: Number(r.pot_id),
    conditionId: r.condition_id as string,
    creator: r.creator as string,
    resolver: r.resolver as string,
    refundTo: r.refund_to as string,
    deadline: Number(r.deadline),
    payees: r.payees.map((address, i) => ({ address, shareBps: r.shares_bps[i] ?? 0 })),
    status: r.status as PotDto["status"],
    outcome: r.outcome as boolean | null,
    total: r.total as string,
    fundingCount: r.funding_count as number,
    createdTx: r.created_tx as string,
    createdTime: num(r.created_time),
    settledTx: (r.settled_tx as string) ?? null,
    settledTime: num(r.settled_time),
    condition: r.c_source
      ? { source: r.c_source as string, key: r.c_key as string, label: (r.c_label as string) ?? null }
      : null,
  };
}

const POT_SELECT = `SELECT p.*, c.source AS c_source, c.key AS c_key, c.label AS c_label
  FROM pots p LEFT JOIN conditions c ON c.condition_id = p.condition_id`;

/** Product views show only pots behind a listed guarantee (always a live Gemini market). */
const LISTED = "p.pot_id IN (SELECT g.pot_id FROM guarantees g WHERE g.listed AND g.pot_id IS NOT NULL)";

export async function listPots(db: Db, opts: { status?: string; limit?: number; listedOnly?: boolean } = {}): Promise<PotDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  if (opts.listedOnly) {
    const rows = opts.status
      ? await db.query<PotRow>(`${POT_SELECT} WHERE ${LISTED} AND p.status = $1 ORDER BY p.pot_id DESC LIMIT $2`, [opts.status, limit])
      : await db.query<PotRow>(`${POT_SELECT} WHERE ${LISTED} ORDER BY p.pot_id DESC LIMIT $1`, [limit]);
    return rows.map(toPot);
  }
  const rows = opts.status
    ? await db.query<PotRow>(`${POT_SELECT} WHERE p.status = $1 ORDER BY p.pot_id DESC LIMIT $2`, [opts.status, limit])
    : await db.query<PotRow>(`${POT_SELECT} ORDER BY p.pot_id DESC LIMIT $1`, [limit]);
  return rows.map(toPot);
}

export async function getPotDetail(db: Db, potId: number) {
  const rows = await db.query<PotRow>(`${POT_SELECT} WHERE p.pot_id = $1`, [potId]);
  if (!rows[0]) return null;
  const events = await db.query<Record<string, unknown>>(
    `SELECT tx_hash, log_index, block_number::text AS block_number, block_time::text AS block_time, event_name, args
     FROM chain_events WHERE pot_id = $1 ORDER BY block_number, log_index`,
    [potId],
  );
  const resolution = await db.query<Record<string, unknown>>(
    "SELECT action, outcome, tx_hash, status, attempts, last_error, updated_at FROM resolutions WHERE pot_id = $1",
    [potId],
  );
  return {
    pot: toPot(rows[0]),
    events: events.map((e) => ({
      txHash: e.tx_hash as string,
      logIndex: e.log_index as number,
      blockNumber: Number(e.block_number),
      time: num(e.block_time),
      name: e.event_name as string,
      args: e.args,
    })),
    payments: await listPayments(db, { potId, limit: 200 }),
    relay: resolution[0] ?? null,
    relayCost: await potRelayCost(db, String(potId)),
  };
}

export async function listPayments(
  db: Db,
  opts: { potId?: number; limit?: number; listedOnly?: boolean } = {},
): Promise<PaymentDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const where = [
    opts.potId !== undefined ? "pot_id = $2" : null,
    opts.listedOnly ? "pot_id IN (SELECT g.pot_id FROM guarantees g WHERE g.listed AND g.pot_id IS NOT NULL)" : null,
  ].filter(Boolean);
  const sql = `SELECT tx_hash, log_index, block_number::text AS block_number, block_time::text AS block_time,
      pot_id::text AS pot_id, kind, recipient, amount FROM payments
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY block_number DESC, log_index DESC LIMIT $1`;
  const rows = await db.query<Record<string, unknown>>(sql, opts.potId !== undefined ? [limit, opts.potId] : [limit]);
  return rows.map((r) => ({
    id: `${r.tx_hash}:${r.log_index}`,
    txHash: r.tx_hash as string,
    logIndex: r.log_index as number,
    blockNumber: Number(r.block_number),
    time: num(r.block_time),
    potId: num(r.pot_id),
    kind: r.kind as PaymentDto["kind"],
    recipient: r.recipient as string,
    amount: r.amount as string,
  }));
}
