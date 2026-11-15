"use client";

import { useEffect, useState } from "react";
import { usePolling } from "@/lib/api";
import { formatClock, formatUsdc } from "@/lib/format";
import { Addr, Card } from "@/components/ui";

type Status = {
  chainId: number;
  vault: string;
  resolver: string | null;
  head: { number: string; timestamp: number; baseFeePerGas: string | null };
  indexer: { primary: string; lastIndexedBlock: string | null; lagBlocks: string | null; lastTick: { at: string; reason: string } | null };
  balance: { usdc: string; nativeWei: string; consistent: boolean; low: boolean; lowThreshold: string } | null;
  spend: {
    totalUsdc: string;
    byKind: { kind: string; count: number; confirmed: number; feeUsdc: string; avgFeeUsdc: string | null; avgGasUsed: string | null; avgLatencyMs: number | null }[];
    avgSettlementUsdc: string | null;
    runwaySettlements: string | null;
  };
  pots: { open: number; settled: number };
  webhooks: { pending: number; retrying: number; delivered: number };
  gasless: { minAmount: string; maxPerHour: number };
};

const kindLabel: Record<string, string> = {
  resolve: "Resolve",
  expire: "Expire",
  fund_gasless: "Gasless funding",
  create_gasless: "Gasless create + fund",
};

function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "bad" ? "text-negative" : ""}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

type Streams = { configured: boolean; lastBatch: { receivedAt: string; end: string | null } | null; behindBlocks: string | null; last5m: { batches: number; p50LatencyMs: number | null } };

/** Operator view of QuickNode Streams, with what to do when deliveries stop. */
function StreamsCard() {
  const { data } = usePolling<Streams>("/api/streams?since=999999999999", 10_000);
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const t = setInterval(tick, 5000);
    Promise.resolve().then(tick);
    return () => clearInterval(t);
  }, []);
  const age = data?.lastBatch && now ? now - new Date(data.lastBatch.receivedAt).getTime() : null;
  const stale = !!data && data.configured && (age === null || age > 120_000);
  return (
    <Card title="QuickNode Streams">
      <dl className="space-y-2 text-sm">
        <Row k="Configured" v={data ? (data.configured ? "yes" : "no (RPC polling only)") : "—"} />
        <Row k="Last delivery" v={age !== null ? `${Math.round(age / 1000)} s ago` : data ? "none" : "—"} />
        <Row k="Deliveries, last 5 min" v={data ? `${data.last5m.batches}${data.last5m.p50LatencyMs !== null ? ` · p50 ${(data.last5m.p50LatencyMs / 1000).toFixed(1)} s` : ""}` : "—"} />
        <Row k="Behind head" v={data?.behindBlocks != null ? `${data.behindBlocks} blocks` : "—"} />
      </dl>
      {stale && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No delivery for over two minutes. QuickNode pauses a stream after repeated failed deliveries: check it in the QuickNode
          dashboard and resume it, or run <code>tsx --env-file=../.env scripts/quicknode-stream.ts --status active</code> in relay/.
          The relay keeps indexing through RPC polling meanwhile.
        </p>
      )}
    </Card>
  );
}

export function StatusView() {
  const { data: s, error } = usePolling<Status>("/api/status", 5000);
  if (error && !s) return <p className="text-sm text-negative">{error}</p>;
  if (!s) return <p className="text-sm text-muted">Loading…</p>;

  const gwei = s.head.baseFeePerGas ? Number(BigInt(s.head.baseFeePerGas) / 10n ** 6n) / 1000 : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Resolver balance"
          value={s.balance ? `${formatUsdc(s.balance.usdc)} USDC` : "—"}
          tone={s.balance?.low ? "bad" : undefined}
          hint={s.balance?.low ? `Below ${formatUsdc(s.balance.lowThreshold)} USDC, top up at faucet.circle.com` : "Pays gas for settlements and gasless funding"}
        />
        <Stat
          label="Runway"
          value={s.spend.runwaySettlements ? `${Number(s.spend.runwaySettlements).toLocaleString("en-US")}` : "—"}
          hint={s.spend.avgSettlementUsdc ? `settlements at ${formatUsdc(s.spend.avgSettlementUsdc)} USDC each` : "no settlements yet"}
        />
        <Stat label="Gas spent" value={`${formatUsdc(s.spend.totalUsdc)} USDC`} hint="sum of gasUsed × effectiveGasPrice from receipts" />
        <Stat label="Pots" value={`${s.pots.open} open`} hint={`${s.pots.settled} settled`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card title="Relay transactions by kind">
          {s.spend.byKind.length === 0 ? (
            <p className="text-sm text-muted">No relay transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Kind</th>
                  <th className="pb-2 text-right font-medium">Tx</th>
                  <th className="pb-2 text-right font-medium">Avg gas</th>
                  <th className="pb-2 text-right font-medium">Avg fee</th>
                  <th className="pb-2 text-right font-medium">Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {s.spend.byKind.map((k) => (
                  <tr key={k.kind} className="border-t border-border">
                    <td className="py-2">{kindLabel[k.kind] ?? k.kind}</td>
                    <td className="py-2 text-right tabular-nums">{k.confirmed}</td>
                    <td className="py-2 text-right tabular-nums">{k.avgGasUsed ? Number(k.avgGasUsed).toLocaleString("en-US") : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{k.avgFeeUsdc ? `${formatUsdc(k.avgFeeUsdc)}` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{k.avgLatencyMs !== null ? `${(k.avgLatencyMs / 1000).toFixed(1)} s` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted">Latency is from broadcast to receipt. Arc finality is deterministic, so one receipt is final.</p>
        </Card>

        <div className="space-y-6">
          <Card title="Chain">
            <dl className="space-y-2 text-sm">
              <Row k="Chain" v={`Arc testnet (${s.chainId})`} />
              <Row k="Head" v={`#${Number(s.head.number).toLocaleString("en-US")}`} />
              <Row k="Base fee" v={gwei !== null ? `${gwei} gwei (floor 20)` : "—"} />
              <Row k="Vault" v={<Addr a={s.vault} />} />
              <Row k="Resolver" v={s.resolver ? <Addr a={s.resolver} /> : "—"} />
            </dl>
          </Card>
          <Card title="USDC on Arc">
            <p className="text-xs text-muted">
              One balance, two interfaces: native (18 decimals, used for gas) and ERC-20 at 0x3600…0000 (6 decimals).
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <Row k="Native" v={s.balance ? <span className="font-mono text-xs">{s.balance.nativeWei}</span> : "—"} />
              <Row k="ERC-20" v={s.balance ? <span className="font-mono text-xs">{s.balance.usdc}</span> : "—"} />
              <Row k="Consistent" v={s.balance ? (s.balance.consistent ? "yes" : "no") : "—"} />
            </dl>
          </Card>
          <StreamsCard />
          <Card title="Indexer and webhooks">
            <dl className="space-y-2 text-sm">
              <Row k="Primary" v={s.indexer.primary} />
              <Row k="Lag" v={s.indexer.lagBlocks !== null ? `${s.indexer.lagBlocks} blocks` : "—"} />
              <Row k="Last tick" v={s.indexer.lastTick ? formatClock(new Date(s.indexer.lastTick.at).getTime()) : "—"} />
              <Row k="Webhooks" v={`${s.webhooks.delivered} delivered · ${s.webhooks.pending} pending · ${s.webhooks.retrying} retrying`} />
              <Row k="Gasless" v={`min ${formatUsdc(s.gasless.minAmount)} USDC · ${s.gasless.maxPerHour}/h per funder`} />
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted">{k}</dt>
      <dd className="truncate text-right">{v}</dd>
    </div>
  );
}
