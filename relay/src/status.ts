import { nativeToUsdcUnits, usdcBalances } from "./arc";
import { publicClient, resolverAccount } from "./chain";
import { getConfig } from "./config";
import { getState, type Db } from "./db";

type KindRow = { kind: string; n: string; confirmed: string; fee_wei: string | null; gas: string | null; latency: string | null };

/**
 * Operational view of the relay, in USDC because Arc charges gas in USDC.
 * - balance: the resolver's USDC, read natively (18 dp) and via ERC-20 (6 dp); `consistent`
 *   shows both views agree, which is how Arc exposes one balance through two interfaces.
 * - spend: fees actually paid (gasUsed × effectiveGasPrice from receipts), per transaction kind.
 * - runway: how many more settlements the balance covers at the observed average cost.
 */
export async function relayStatus(db: Db) {
  const cfg = getConfig();
  const client = publicClient();
  const resolver = cfg.resolverKey ? resolverAccount().address : null;

  const [balances, block, kinds, pots, webhooks, cursor, lastTick] = await Promise.all([
    resolver ? usdcBalances(client, resolver) : null,
    client.getBlock({ blockTag: "latest" }),
    db.query<KindRow>(
      `SELECT kind, count(*)::text AS n, count(*) FILTER (WHERE status = 'confirmed')::text AS confirmed,
         sum(fee_wei)::text AS fee_wei, avg(gas_used)::bigint::text AS gas, avg(latency_ms)::int::text AS latency
       FROM relay_txs GROUP BY kind ORDER BY kind`,
    ),
    db.query<{ settled: string; open: string }>(
      `SELECT count(*) FILTER (WHERE status <> 'open')::text AS settled, count(*) FILTER (WHERE status = 'open')::text AS open FROM pots`,
    ),
    db.query<{ pending: string; failed: string; delivered: string }>(
      `SELECT count(*) FILTER (WHERE delivered_at IS NULL AND attempts = 0)::text AS pending,
         count(*) FILTER (WHERE delivered_at IS NULL AND attempts > 0)::text AS failed,
         count(*) FILTER (WHERE delivered_at IS NOT NULL)::text AS delivered
       FROM webhook_deliveries`,
    ),
    getState(db, "rpc_last_indexed_block"),
    getState(db, "last_tick"),
  ]);

  const byKind = kinds.map((k) => {
    const feeWei = BigInt(k.fee_wei ?? "0");
    const confirmed = Number(k.confirmed);
    return {
      kind: k.kind,
      count: Number(k.n),
      confirmed,
      feeUsdc: nativeToUsdcUnits(feeWei).toString(),
      avgFeeUsdc: confirmed ? nativeToUsdcUnits(feeWei / BigInt(confirmed)).toString() : null,
      avgGasUsed: k.gas,
      avgLatencyMs: k.latency ? Number(k.latency) : null,
    };
  });
  const totalWei = kinds.reduce((s, k) => s + BigInt(k.fee_wei ?? "0"), 0n);
  const settleKinds = byKind.filter((k) => k.kind === "resolve" || k.kind === "expire");
  const settleCount = settleKinds.reduce((s, k) => s + k.confirmed, 0);
  const settleFees = settleKinds.reduce((s, k) => s + BigInt(k.feeUsdc), 0n);
  const avgSettle = settleCount ? settleFees / BigInt(settleCount) : null;
  const erc20 = balances?.erc20 ?? 0n;

  return {
    chainId: cfg.chainId,
    vault: cfg.vault,
    resolver,
    head: { number: block.number.toString(), timestamp: Number(block.timestamp), baseFeePerGas: block.baseFeePerGas?.toString() ?? null },
    indexer: {
      primary: cfg.indexerPrimary,
      lastIndexedBlock: cursor ?? null,
      lagBlocks: cursor ? (block.number - BigInt(cursor)).toString() : null,
      lastTick: lastTick ? JSON.parse(lastTick) : null,
    },
    balance: balances && {
      usdc: erc20.toString(),
      nativeWei: balances.native.toString(),
      consistent: balances.consistent,
      low: erc20 < cfg.lowBalance,
      lowThreshold: cfg.lowBalance.toString(),
    },
    spend: {
      totalUsdc: nativeToUsdcUnits(totalWei).toString(),
      byKind,
      avgSettlementUsdc: avgSettle?.toString() ?? null,
      runwaySettlements: avgSettle && avgSettle > 0n ? (erc20 / avgSettle).toString() : null,
    },
    pots: { open: Number(pots[0]?.open ?? 0), settled: Number(pots[0]?.settled ?? 0) },
    webhooks: {
      pending: Number(webhooks[0]?.pending ?? 0),
      retrying: Number(webhooks[0]?.failed ?? 0),
      delivered: Number(webhooks[0]?.delivered ?? 0),
    },
    gasless: { minAmount: cfg.gaslessMinAmount.toString(), maxPerHour: cfg.gaslessMaxPerHour },
  };
}

/** Relay transactions and their USDC cost for one pot. */
export async function potRelayCost(db: Db, potId: string) {
  const rows = await db.query<{ tx_hash: string; kind: string; status: string; gas_used: string | null; fee_wei: string | null; latency_ms: number | null }>(
    `SELECT tx_hash, kind, status, gas_used::text AS gas_used, fee_wei::text AS fee_wei, latency_ms
     FROM relay_txs WHERE pot_id = $1 ORDER BY submitted_at`,
    [potId],
  );
  const txs = rows.map((r) => ({
    txHash: r.tx_hash,
    kind: r.kind,
    status: r.status,
    gasUsed: r.gas_used,
    feeUsdc: r.fee_wei ? nativeToUsdcUnits(BigInt(r.fee_wei)).toString() : null,
    latencyMs: r.latency_ms,
  }));
  const total = txs.reduce((s, t) => s + BigInt(t.feeUsdc ?? "0"), 0n);
  return { totalUsdc: total.toString(), txs };
}
