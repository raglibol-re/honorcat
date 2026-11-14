import { decodeEventLog, getAddress, type Address, type Hex } from "viem";
import { verdictVaultAbi } from "../abi";
import type { Db } from "../db";
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

type Decoded = RawLog & { eventName: string; args: Record<string, unknown>; potId: bigint | null };

function toJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toJson(v)]));
  }
  return value;
}

export function decodeVaultLogs(logs: RawLog[], vault: Address): Decoded[] {
  const out: Decoded[] = [];
  for (const log of logs) {
    if (getAddress(log.address) !== vault) continue;
    try {
      const ev = decodeEventLog({ abi: verdictVaultAbi, topics: log.topics as [Hex, ...Hex[]], data: log.data });
      if (ev.eventName === "EIP712DomainChanged") continue;
      const args = (ev.args ?? {}) as Record<string, unknown>;
      const potId = typeof args.potId === "bigint" ? args.potId : null;
      out.push({ ...log, eventName: ev.eventName, args: toJson(args) as Record<string, unknown>, potId });
    } catch {
      // Not one of our events (or malformed); ignore.
    }
  }
  return out;
}

/**
 * Idempotently stores vault logs and refreshes the projection of every affected pot.
 * Safe to call with the same logs from several sources (RPC poller, Streams webhook, tx receipts).
 */
export async function ingestLogs(
  db: Db,
  vault: Address,
  logs: RawLog[],
  source: string,
  blockTime: BlockTimeFn,
): Promise<{ received: number; inserted: number; pots: string[] }> {
  const decoded = decodeVaultLogs(logs, vault);
  const times = new Map<bigint, number | null>();
  for (const d of decoded) {
    if (!times.has(d.blockNumber)) times.set(d.blockNumber, await blockTime(d.blockNumber));
  }

  let inserted = 0;
  const affected = new Set<string>();
  const fresh: IngestedEvent[] = [];
  for (const d of decoded) {
    const rows = await db.query(
      `INSERT INTO chain_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tx_hash, log_index) DO NOTHING
       RETURNING tx_hash`,
      [
        d.transactionHash.toLowerCase(),
        d.logIndex,
        d.blockNumber.toString(),
        times.get(d.blockNumber),
        d.eventName,
        d.potId?.toString() ?? null,
        JSON.stringify(d.args),
        source,
      ],
    );
    if (rows.length) {
      inserted++;
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
    if (d.potId !== null) affected.add(d.potId.toString());
  }
  for (const potId of affected) await projectPot(db, potId);
  // After projection, so pot -> condition -> integration can be resolved for PotCreated too.
  if (fresh.length) await enqueueWebhooks(db, fresh);
  return { received: logs.length, inserted, pots: [...affected] };
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
     FROM chain_events WHERE pot_id = $1 ORDER BY block_number, log_index`,
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
