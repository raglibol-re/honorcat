import { decodeEventLog, getAddress, type Address, type Hex } from "viem";
import { guaranteeBookAbi, verdictVaultAbi } from "../abi";
import { ARC_MEMO } from "../arc";
import { getConfig } from "../config";
import type { Db } from "../db";
import { decodeMemoBody, decodeMemoLog } from "../memo";
import { enqueueWebhooks, type IngestedEvent } from "../webhooks";

/** A log in the shape both eth_getLogs and QuickNode Streams deliver (numbers already parsed). */
export type RawLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
};

export type BlockTimeFn = (blockNumber: bigint) => Promise<number | null>;

type Decoded = RawLog & {
  contract: "vault" | "book";
  eventName: string;
  args: Record<string, unknown>;
  potId: bigint | null;
  gid: bigint | null;
};

function toJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  }
  return value;
}

export function decodeVaultLogs(logs: RawLog[], vault: Address, book?: Address | null): Decoded[] {
  const out: Decoded[] = [];
  for (const log of logs) {
    const addr = getAddress(log.address);
    const contract = addr === vault ? "vault" : book && addr === book ? "book" : null;
    if (!contract) continue;
    try {
      const ev = decodeEventLog({
        abi: contract === "vault" ? verdictVaultAbi : guaranteeBookAbi,
        topics: log.topics as [Hex, ...Hex[]],
        data: log.data,
      });
      if (ev.eventName === "EIP712DomainChanged") continue;
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const potId = typeof args.potId === "bigint" ? args.potId : null;
      const gid = contract === "book" && typeof args.gid === "bigint" ? args.gid : null;
      out.push({ ...log, contract, eventName: ev.eventName, args: toJson(args) as Record<string, unknown>, potId, gid });
    } catch {
      // Not one of our events (or malformed); ignore.
    }
  }
  return out;
}

/** The GuaranteeBook address if configured; never throws (tests run without full config). */
function configuredBook(): Address | null {
  try {
    return getConfig().guarantees?.book ?? null;
  } catch {
    return null;
  }
}

/**
 * Stores Arc Memo events for transactions that touch our contracts. BeforeMemo and Memo are
 * paired by memoIndex inside a transaction; the memo then covers the logs in between.
 */
async function ingestMemos(
  db: Db,
  logs: RawLog[],
  ours: Set<string>,
  keep: (target: Address) => boolean,
  source: string,
  times: Map<bigint, number | null>,
): Promise<number> {
  const before = new Map<string, number>();
  let inserted = 0;
  for (const l of logs) {
    if (getAddress(l.address) !== ARC_MEMO) continue;
    if (!ours.has(l.transactionHash.toLowerCase())) continue;
    const m = decodeMemoLog(l);
    if (!m) continue;
    const key = `${m.txHash.toLowerCase()}:${m.memoIndex}`;
    if (m.kind === "before") {
      before.set(key, m.logIndex);
      continue;
    }
    if (!keep(getAddress(m.target))) continue;
    const { text } = decodeMemoBody(m.memo);
    const rows = await db.query(
      `INSERT INTO memos (tx_hash, log_index, before_log_index, memo_index, sender, target, memo_id, memo_hex, memo_text, block_number, block_time, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (tx_hash, log_index) DO NOTHING RETURNING tx_hash`,
      [
        m.txHash.toLowerCase(),
        m.logIndex,
        before.get(key) ?? null,
        m.memoIndex.toString(),
        m.sender.toLowerCase(),
        m.target.toLowerCase(),
        m.memoId.toLowerCase(),
        m.memo,
        text || null,
        m.blockNumber.toString(),
        times.get(m.blockNumber) ?? null,
        source,
      ],
    );
    inserted += rows.length;
  }
  return inserted;
}

/**
 * Idempotently stores vault and GuaranteeBook logs (and the Memo events in the same
 * transactions) and refreshes the projection of every affected pot. Safe to call with the same
 * logs from several sources (RPC poller, Streams webhook, tx receipts).
 */
export async function ingestLogs(
  db: Db,
  vault: Address,
  logs: RawLog[],
  source: string,
  blockTime: BlockTimeFn,
  opts: { book?: Address | null; extraMemoTargets?: Address[]; memoTxs?: Iterable<string> } = {},
): Promise<{ received: number; inserted: number; pots: string[]; memos: number }> {
  const book = opts.book === undefined ? configuredBook() : opts.book;
  const sorted = [...logs].sort((x, y) =>
    x.blockNumber === y.blockNumber ? x.logIndex - y.logIndex : x.blockNumber < y.blockNumber ? -1 : 1,
  );
  const decoded = decodeVaultLogs(sorted, vault, book);
  const times = new Map<bigint, number | null>();
  const blocks = new Set<bigint>(decoded.map((d) => d.blockNumber));
  for (const l of sorted) if (getAddress(l.address) === ARC_MEMO) blocks.add(l.blockNumber);
  for (const n of blocks) times.set(n, await blockTime(n));

  let inserted = 0;
  const affected = new Set<string>();
  const fresh: IngestedEvent[] = [];
  for (const d of decoded) {
    // Book events other than GuaranteeOpened carry only the gid; map it to the pot.
    let potId = d.potId;
    if (d.contract === "book" && potId === null && d.gid !== null) {
      const r = await db.query<{ pot_id: string }>(
        `SELECT pot_id::text AS pot_id FROM chain_events WHERE contract = 'book' AND event_name = 'GuaranteeOpened' AND gid = $1 LIMIT 1`,
        [d.gid.toString()],
      );
      potId = r[0] ? BigInt(r[0].pot_id) : null;
    }
    const rows = await db.query(
      `INSERT INTO chain_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source, contract, gid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING tx_hash`,
      [
        d.transactionHash.toLowerCase(),
        d.logIndex,
        d.blockNumber.toString(),
        times.get(d.blockNumber),
        d.eventName,
        potId?.toString() ?? null,
        JSON.stringify(d.args),
        source,
        d.contract,
        d.gid?.toString() ?? null,
      ],
    );
    if (d.contract === "book" && d.eventName === "GuaranteeOpened" && d.gid !== null && d.potId !== null) {
      await db.query(`UPDATE guarantees SET gid = $1, status = 'live' WHERE pot_id = $2 AND gid IS NULL`, [
        d.gid.toString(),
        d.potId.toString(),
      ]);
    }
    if (rows.length) {
      inserted++;
      if (d.contract === "vault") {
        fresh.push({
          txHash: d.transactionHash.toLowerCase(),
          logIndex: d.logIndex,
          blockNumber: d.blockNumber,
          blockTime: times.get(d.blockNumber) ?? null,
          eventName: d.eventName,
          potId: d.potId,
          args: d.args,
        });
      }
    }
    if (d.contract === "vault" && d.potId !== null) affected.add(d.potId.toString());
  }
  for (const potId of affected) await projectPot(db, potId);
  // After projection, so pot -> condition -> integration can be resolved for PotCreated too.
  if (fresh.length) await enqueueWebhooks(db, fresh);

  const ours = new Set<string>([...decoded.map((d) => d.transactionHash.toLowerCase()), ...[...(opts.memoTxs ?? [])].map((t) => t.toLowerCase())]);
  const targets = new Set([vault, ...(book ? [book] : []), ...(opts.extraMemoTargets ?? [])].map((x) => getAddress(x)));
  const memos = await ingestMemos(db, sorted, ours, (t) => targets.has(t), source, times);
  return { received: logs.length, inserted, pots: [...affected], memos };
}

type EventRow = {
  tx_hash: string;
  block_number: string;
  block_time: string | null;
  event_name: string;
  args: Record<string, unknown>;
};

/** Rebuilds one row of `pots` from its full event history (order-independent ingestion). */
export async function projectPot(db: Db, potId: string): Promise<void> {
  const events = await db.query<EventRow>(
    `SELECT tx_hash, block_number::text AS block_number, block_time::text AS block_time, event_name, args
     FROM chain_events WHERE pot_id = $1 AND contract = 'vault' ORDER BY block_number, log_index`,
    [potId],
  );
  const created = events.find((e) => e.event_name === "PotCreated");
  if (!created) return; // creation not seen yet; a later ingest will project it

  const a = created.args as {
    conditionId: string;
    creator: string;
    resolver: string;
    refundTo: string;
    deadline: string;
    payees: string[];
    sharesBps: string[];
  };
  let status = "open";
  let outcome: boolean | null = null;
  let total = 0n;
  let fundingCount = 0;
  let settledTx: string | null = null;
  let settledTime: string | null = null;

  for (const e of events) {
    const args = e.args as Record<string, string | boolean>;
    if (e.event_name === "PotFunded") {
      total = BigInt(args.newTotal as string);
      fundingCount++;
    } else if (e.event_name === "PotResolved") {
      status = "resolved";
      outcome = args.outcome as boolean;
      settledTx = e.tx_hash;
      settledTime = e.block_time;
    } else if (e.event_name === "PotExpired") {
      status = "expired";
      settledTx = e.tx_hash;
      settledTime = e.block_time;
    }
  }

  await db.query(
    `INSERT INTO pots (pot_id, condition_id, creator, resolver, refund_to, deadline, payees, shares_bps, status,
                       outcome, total, funding_count, created_block, created_tx, created_time, settled_tx, settled_time, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17, now())
     ON CONFLICT (pot_id) DO UPDATE SET
       status = EXCLUDED.status, outcome = EXCLUDED.outcome, total = EXCLUDED.total,
       funding_count = EXCLUDED.funding_count, settled_tx = EXCLUDED.settled_tx,
       settled_time = EXCLUDED.settled_time, updated_at = now()`,
    [
      potId,
      a.conditionId.toLowerCase(),
      a.creator,
      a.resolver,
      a.refundTo,
      a.deadline,
      JSON.stringify(a.payees),
      JSON.stringify(a.sharesBps.map(Number)),
      status,
      outcome,
      total.toString(),
      fundingCount,
      created.block_number,
      created.tx_hash,
      created.block_time,
      settledTx,
      settledTime,
    ],
  );
}
