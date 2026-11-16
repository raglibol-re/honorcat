"use client";

import { useEffect, useState } from "react";
import { usePolling } from "@/lib/api";
import { formatClock, formatUsdc } from "@/lib/format";
import { Addr } from "@/components/ui";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";

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
  pot_attest: "Prices (windows)",
  pot_settle: "Settlements",
  pot_exec: "Passkey and practice actions",
  pot_forward: "Forwarded signed actions",
  pot_house: "Housekeeping",
  pot_gateway: "Gateway mints",
  pot_create: "Create",
  pot_join: "Join",
  pot_exit: "Exit",
};
const POTS_ADDRESS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59";
const MEDIAN_RESOLVER = "0x62FB60fbB5fC1903A4af3dc61186C2ed7f153c62";

type Mark = "ok" | "pending" | "attention";

/** A big figure in the reference's condensed numerals, no box. */
function Figure({ label, value, hint, attention }: { label: string; value: React.ReactNode; hint?: React.ReactNode; attention?: boolean }) {
  return (
    <div style={{ flex: "1 1 200px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4, paddingTop: 14 }}>
      <span style={{ fontSize: 16, color: C.muted }}>{label}</span>
      <span style={{ fontFamily: F.cond, fontSize: 52, fontWeight: 600, lineHeight: 1, color: attention ? C.signalInk : C.ink, fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
      {hint && <span style={{ fontSize: 15, lineHeight: 1.4, color: attention ? C.signalInk : C.muted }}>{hint}</span>}
    </div>
  );
}

/** A titled list of rows between ink rules (recipient card style). */
function Rows({ title, children, note }: { title: string; children: React.ReactNode; note?: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>{title}</h2>
      {/* Row rules are the 1px gaps showing the faint background between rows. */}
      <div style={{ borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, display: "flex", flexDirection: "column", gap: 1, background: C.faint }}>{children}</div>
      {note}
    </section>
  );
}

/** One row: cat head marker (ink = fine, outline = unknown, signal = needs attention), name, value. */
function Row({ k, v, mark = "ok" }: { k: string; v: React.ReactNode; mark?: Mark }) {
  return (
    <div style={{ background: C.page, padding: "9px 0", display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      {mark === "pending" ? <CatHead width={18} height={17} outline /> : <CatHead width={18} height={17} fill={mark === "attention" ? C.signal : C.ink} />}
      <span style={{ fontSize: 17, fontWeight: 600, flex: "none", color: mark === "pending" ? C.muted : C.ink }}>{k}</span>
      <span style={{ fontSize: 15, color: mark === "attention" ? C.signalInk : C.muted, marginLeft: "auto", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span>
    </div>
  );
}

const note = (text: React.ReactNode) => <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: C.muted }}>{text}</p>;
const mono = (text: string) => <span style={{ fontFamily: F.mono, fontSize: 13 }}>{text}</span>;

type Streams = { configured: boolean; lastBatch: { receivedAt: string; end: string | null } | null; behindBlocks: string | null; last5m: { batches: number; p50LatencyMs: number | null } };

/** Operator view of QuickNode Streams, with what to do when deliveries stop. */
function StreamsRows() {
  const { data } = usePolling<Streams>("/api/streams?since=999999999999", 10_000);
  const { data: ev } = usePolling<{ streamsSinceFilter?: { sinceBlock: string; total: number; streams: number; pollerLagBlocks: number } }>("/api/hc/evidence", 30_000);
  const share = ev?.streamsSinceFilter;
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
    <Rows
      title="QuickNode Streams"
      note={
        stale && (
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.45, color: C.signalInk, borderLeft: `3px solid ${C.signal}`, paddingLeft: 12 }}>
            No delivery for over two minutes. QuickNode pauses a stream after repeated failed deliveries: check it in the QuickNode dashboard and
            resume it, or run <code style={{ fontFamily: F.mono, fontSize: 13 }}>tsx --env-file=../.env scripts/quicknode-stream.ts --status active</code> in relay/.
            The relay keeps indexing through RPC polling meanwhile.
          </p>
        )
      }
    >
      <Row k="Configured" v={data ? (data.configured ? "yes" : "no (RPC polling only)") : "–"} mark={!data ? "pending" : data.configured ? "ok" : "attention"} />
      <Row k="Last delivery" v={age !== null ? `${Math.round(age / 1000)} s ago` : data ? "none" : "–"} mark={!data ? "pending" : stale ? "attention" : "ok"} />
      <Row
        k="Deliveries, last 5 min"
        v={data ? `${data.last5m.batches}${data.last5m.p50LatencyMs !== null ? `, median ${(data.last5m.p50LatencyMs / 1000).toFixed(1)} s` : ""}` : "–"}
        mark={data ? "ok" : "pending"}
      />
      <Row k="Behind head" v={data?.behindBlocks != null ? `${data.behindBlocks} blocks` : "–"} mark={data?.behindBlocks != null ? "ok" : "pending"} />
      <Row
        k="Pot events first seen by Streams"
        v={
          share
            ? share.total
              ? `${share.streams} of ${share.total} (${Math.round((100 * share.streams) / share.total)}%) since block ${Number(share.sinceBlock).toLocaleString("en-US")}; the RPC poller trails the head by ${share.pollerLagBlocks} blocks as the fallback`
              : `none yet since block ${Number(share.sinceBlock).toLocaleString("en-US")}`
            : "–"
        }
        mark={!share ? "pending" : share.total && share.streams / share.total >= 0.5 ? "ok" : share.total ? "attention" : "pending"}
      />
    </Rows>
  );
}

export function StatusView() {
  const { data: s, error } = usePolling<Status>("/api/status", 5000);
  const { data: pool } = usePolling<{ pool: string; givenToday: string; dailyLimit: string }>("/api/hc/funding", 30_000);
  const { data: potsList } = usePolling<{ pots: { state: string }[] }>("/api/hc/pots?limit=200", 30_000);
  if (error && !s) return <p style={{ margin: 0, fontSize: 17, color: C.signalInk }}>{error}</p>;
  if (!s) return <p style={{ margin: 0, fontSize: 17, color: C.muted }}>Loading…</p>;

  // The pots relay only (the retired products' kinds are not shown); runway in relay transactions.
  const potKinds = s.spend.byKind.filter((k) => k.kind.startsWith("pot_"));
  const fees = potKinds.filter((k) => k.avgFeeUsdc !== null && k.confirmed > 0);
  const avgFee = fees.length ? fees.reduce((a, k) => a + Number(k.avgFeeUsdc) * k.confirmed, 0) / fees.reduce((a, k) => a + k.confirmed, 0) : null;
  const runway = pool && avgFee ? Math.floor(Number(pool.pool) / avgFee) : null;
  const count = (states: string[]) => (potsList?.pots ?? []).filter((p) => states.includes(p.state)).length;
  const gwei = s.head.baseFeePerGas ? Number(BigInt(s.head.baseFeePerGas) / 10n ** 6n) / 1000 : null;
  const th = { textAlign: "right", fontWeight: 500, fontSize: 15, color: C.muted, padding: "10px 0 8px 12px" } as const;
  const td = { textAlign: "right", padding: "9px 0 9px 12px", fontVariantNumeric: "tabular-nums" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "20px 40px", borderTop: `1.5px solid ${C.ink}` }}>
        <Figure
          label="Relay wallet (Circle)"
          value={pool ? `${formatUsdc(pool.pool)} USDC` : "–"}
          attention={!!pool && Number(pool.pool) < 5_000_000}
          hint={pool && Number(pool.pool) < 5_000_000 ? "Low: top it up from faucet.circle.com (Arc Testnet)." : "Pays gas for every pot transaction and gives new players test money"}
        />
        <Figure
          label="Runway"
          value={runway !== null ? runway.toLocaleString("en-US") : "–"}
          hint={avgFee !== null ? `relay transactions at about ${formatUsdc(String(Math.round(avgFee)))} USDC each, before the next refill` : "measured once the relay has sent its first pot transactions"}
        />
        <Figure label="Gas spent on pots" value={`${formatUsdc(String(potKinds.reduce((a, k) => a + Number(k.feeUsdc), 0)))} USDC`} hint="gasUsed × effectiveGasPrice from receipts" />
        <Figure label="Pots" value={potsList ? `${count(["Open", "Joining", "Live", "ExitRequested"])} running` : "–"} hint={potsList ? `${count(["Divided", "Settled", "Expired"])} ended (practice pots not counted)` : undefined} />
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>Relay transactions</h2>
        {potKinds.length === 0 ? (
          note("No relay transactions yet.")
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 17, borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", paddingLeft: 0 }}>Kind</th>
                  <th style={th}>Tx</th>
                  <th style={th}>Avg gas</th>
                  <th style={th}>Avg fee</th>
                  <th style={th}>Avg latency</th>
                </tr>
              </thead>
              <tbody>
                {potKinds.map((k) => (
                  <tr key={k.kind} style={{ borderTop: `1px solid ${C.faint}` }}>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 0, fontWeight: 600 }}>{kindLabel[k.kind] ?? k.kind}</td>
                    <td style={td}>{k.confirmed}</td>
                    <td style={td}>{k.avgGasUsed ? Number(k.avgGasUsed).toLocaleString("en-US") : "–"}</td>
                    <td style={td}>{k.avgFeeUsdc ? `${formatUsdc(k.avgFeeUsdc)}` : "–"}</td>
                    <td style={td}>{k.avgLatencyMs !== null ? `${(k.avgLatencyMs / 1000).toFixed(1)} s` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {note("Latency is from broadcast to receipt. Arc finality is deterministic, so one receipt is final.")}
      </section>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: 56 }}>
        <Rows title="Chain">
          <Row k="Chain" v={`Arc testnet (${s.chainId})`} />
          <Row k="Head" v={`#${Number(s.head.number).toLocaleString("en-US")}`} />
          <Row k="Base fee" v={gwei !== null ? `${gwei} gwei (floor 20)` : "–"} mark={gwei !== null ? "ok" : "pending"} />
          <Row k="Pot contract" v={<Addr a={POTS_ADDRESS} />} />
          <Row k="Price rule (MedianResolver)" v={<Addr a={MEDIAN_RESOLVER} />} />
        </Rows>
        <Rows title="USDC on Arc" note={note("One balance, two interfaces: native (18 decimals, used for gas) and ERC-20 at 0x3600…0000 (6 decimals).")}>
          <Row k="Native" v={s.balance ? mono(s.balance.nativeWei) : "–"} mark={s.balance ? "ok" : "pending"} />
          <Row k="ERC-20" v={s.balance ? mono(s.balance.usdc) : "–"} mark={s.balance ? "ok" : "pending"} />
          <Row k="Consistent" v={s.balance ? (s.balance.consistent ? "yes" : "no") : "–"} mark={!s.balance ? "pending" : s.balance.consistent ? "ok" : "attention"} />
        </Rows>
        <StreamsRows />
        <Rows title="Indexer">
          <Row k="Primary source" v="QuickNode Streams (pot events arrive within seconds of their block)" mark="ok" />
          <Row k="Fallback" v="RPC poller, 90 blocks behind the head, fills any gap" mark="ok" />
          <Row k="Last relay tick" v={s.indexer.lastTick ? formatClock(new Date(s.indexer.lastTick.at).getTime()) : "–"} mark={s.indexer.lastTick ? "ok" : "pending"} />
        </Rows>
      </div>
    </div>
  );
}
