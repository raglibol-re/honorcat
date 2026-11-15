"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";
import { useNow } from "@/lib/useNow";
import { Tx } from "@/components/ui";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";

type Batch = {
  id: number;
  receivedAt: string;
  start: string | null;
  end: string | null;
  latencyMs: number | null;
  bytes: number;
  gzip: boolean;
  logs: number;
  inserted: number;
  events: { name: string; potId: string | null; block?: string }[];
};

type Overview = {
  configured: boolean;
  primary: string;
  vault: string;
  head: { number: string; timestamp: number } | null;
  lastBatch: { receivedAt: string; end: string | null } | null;
  behindBlocks: string | null;
  last5m: { batches: number; blocks: number; avgLatencyMs: number | null; p50LatencyMs: number | null; p95LatencyMs: number | null; vaultLogs: number; bytes: number };
  batches: Batch[];
  sources: Record<string, number>;
  recentEvents: { name: string; potId: string | null; source: string; block: string; txHash: string; indexLagMs: number | null }[];
};

/**
 * A batch plus the client time it was first seen (0 = present on first load, not animated) and a
 * fixed stagger so several batches from one poll travel one after another.
 */
type Arrival = Batch & { seenAt: number; stagger: number };

const POLL_MS = 1500;
const BLOCK_MS = 500; // Arc testnet produces ~2 blocks per second
const TILES = 36;

/**
 * Polls /api/streams and keeps an accumulated, de-duplicated list of batches. New batches are
 * stamped with the client time they first appeared; the UI animates only those.
 */
function useStreamFeed() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [fetchedAt, setFetchedAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === "visible") {
        try {
          const o = await getJson<Overview>(`/api/streams?since=${lastId.current}`);
          const t = Date.now();
          const fresh = o.batches.filter((b) => b.id > lastId.current).sort((a, b) => a.id - b.id);
          if (fresh.length) lastId.current = fresh[fresh.length - 1]!.id;
          const seenAt = first.current ? 0 : t;
          first.current = false;
          setArrivals((prev) => [...prev, ...fresh.map((b, i) => ({ ...b, seenAt, stagger: Math.min(i, 6) * 380 }))].slice(-200));
          setOverview(o);
          setFetchedAt(t);
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      if (!stopped) timer = setTimeout(run, POLL_MS);
    };
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return { overview, arrivals, fetchedAt, error };
}

const fmtAge = (ms: number | null) =>
  ms === null ? "—" : ms < 60_000 ? `${Math.round(ms / 1000)} s` : ms < 3_600_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)} h`;

const fmtMs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "—" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

const STAGES = [
  { key: "arc", title: "Arc testnet", sub: "a new block every ~0.5 s" },
  { key: "qn", title: "QuickNode Streams", sub: "runs our filter on each block range" },
  { key: "hook", title: "Webhook", sub: "signature checked" },
  { key: "relay", title: "Relay", sub: "indexes and wakes up" },
  { key: "vault", title: "Vault and ledger", sub: "pays out or refunds" },
] as const;

const cond = { fontFamily: F.cond } as const;
const mono = { fontFamily: F.mono } as const;
const rule = { borderTop: `1.5px solid ${C.ink}` } as const;
const row = { borderTop: `1px solid ${C.faint}` } as const;

function H2({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ ...rule, paddingTop: 14, display: "flex", flexWrap: "wrap", gap: "8px 24px", alignItems: "baseline", justifyContent: "space-between" }}>
      <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>{children}</h2>
      {right}
    </div>
  );
}

export function LiveView() {
  const { overview: o, arrivals, fetchedAt, error } = useStreamFeed();
  const now = useNow();

  if (error && !o) return <p style={{ fontSize: 17, color: C.signalInk }}>{error}</p>;
  if (!o) return <p style={{ fontSize: 17, color: C.muted }}>Connecting…</p>;

  // Packets still in flight: arrived during the last few seconds (client clock).
  const inFlight = arrivals.filter((a) => a.seenAt > 0 && now - a.seenAt < 4500 + a.stagger);
  const lastArrival = arrivals.filter((a) => a.seenAt > 0).at(-1);
  const lastEventArrival = arrivals.filter((a) => a.seenAt > 0 && a.logs > 0).at(-1);

  // Head estimate between polls, so the block strip keeps moving like the chain does.
  const headAtFetch = o.head ? Number(o.head.number) : 0;
  const head = headAtFetch && fetchedAt && now ? headAtFetch + Math.max(0, Math.floor((now - fetchedAt) / BLOCK_MS)) : headAtFetch;
  const delivered = new Set<number>();
  const withEvents = new Set<number>();
  for (const a of arrivals) {
    if (!a.end) continue;
    const end = Number(a.end);
    const start = a.start ? Number(a.start) : end;
    for (let n = Math.max(start, head - TILES); n <= end; n++) delivered.add(n);
    for (const e of a.events) if (e.block) withEvents.add(Number(e.block));
  }
  const tiles = head ? Array.from({ length: TILES }, (_, i) => head - TILES + 1 + i) : [];

  const lastAge = o.lastBatch && now ? now - new Date(o.lastBatch.receivedAt).getTime() : null;
  const healthy = o.configured && lastAge !== null && lastAge < 60_000;
  const totalSources = Object.values(o.sources).reduce((a, b) => a + b, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 56 }}>
      {!o.configured && (
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>Push delivery is off on this deployment. Chain events are read directly from Arc instead.</p>
      )}
      {o.configured && !o.lastBatch && <p style={{ margin: 0, fontSize: 17, color: C.muted }}>Waiting for the next delivery from QuickNode.</p>}

      {/* ---------------------------------------------------------------- pipeline */}
      <section style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <H2
          right={
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 17, fontWeight: 600, color: healthy ? C.ink : C.muted }}>
              {healthy ? <CatHead width={20} height={18} fill={C.signal} /> : <CatHead width={20} height={18} fill={C.muted} outline />}
              {healthy ? `streaming · last delivery ${fmtMs(lastAge)} ago` : o.lastBatch ? `last delivery ${fmtAge(lastAge)} ago` : "waiting for the next delivery"}
            </span>
          }
        >
          Pipeline
        </H2>
        <div style={{ position: "relative", paddingTop: 4 }}>
          {/* track */}
          <div style={{ position: "absolute", left: "10%", right: "10%", top: 32, height: 0, borderTop: `2px dashed ${C.dash}` }} />
          <div style={{ position: "absolute", left: "10%", right: "10%", top: 32, height: 0, zIndex: 1 }}>
            {inFlight.map((a) => {
              const toVault = a.logs > 0;
              return (
                <span
                  key={a.id}
                  className="packet block"
                  style={
                    {
                      width: toVault ? 14 : 9,
                      height: toVault ? 14 : 9,
                      background: toVault ? C.signal : C.ink,
                      outline: `2px solid ${C.page}`,
                      "--dur": toVault ? "2200ms" : "1500ms",
                      animationName: toVault ? "packet-travel" : "packet-travel-short",
                      animationDelay: `${a.stagger}ms`,
                    } as React.CSSProperties
                  }
                  title={`blocks ${a.start ?? "?"}–${a.end ?? "?"}`}
                />
              );
            })}
          </div>
          {/* stages */}
          <ol className="grid grid-cols-5 gap-1 sm:gap-4" style={{ position: "relative", margin: 0, padding: 0, listStyle: "none" }}>
            {STAGES.map((s, i) => {
              const pingKey = s.key === "vault" ? lastEventArrival?.id : lastArrival?.id;
              return (
                <li key={s.key} style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", minWidth: 0 }}>
                  <span
                    style={{
                      position: "relative",
                      display: "flex",
                      width: 56,
                      height: 56,
                      alignItems: "center",
                      justifyContent: "center",
                      background: C.ink,
                      color: C.page,
                      ...cond,
                      fontSize: 34,
                      fontWeight: 700,
                    }}
                  >
                    {pingKey && <span key={`${s.key}-${pingKey}`} className="stage-ping" style={{ position: "absolute", inset: 0, animationDelay: `${i * 300}ms` }} />}
                    {i + 1}
                  </span>
                  <span style={{ marginTop: 10, fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>{s.title}</span>
                  <span className="hidden sm:block" style={{ fontSize: 15, color: C.muted, lineHeight: 1.35 }}>
                    {s.sub}
                  </span>
                  <span style={{ marginTop: 4, fontSize: 13, color: C.muted, overflowWrap: "anywhere" }}>
                    {s.key === "arc" && <span style={mono}>#{head ? head.toLocaleString("en-US") : "—"}</span>}
                    {s.key === "qn" && `${o.last5m.batches} deliveries / 5 min`}
                    {s.key === "hook" && `median ${fmtMs(o.last5m.p50LatencyMs)}`}
                    {s.key === "relay" && (o.primary === "streams" ? "Streams first" : "Streams + RPC backup")}
                  </span>
                  {s.key === "vault" && (
                    <span style={{ position: "relative", marginTop: 4, height: 24, fontSize: 13 }}>
                      {inFlight
                        .filter((a) => a.logs > 0)
                        .flatMap((a) => a.events.map((e, j) => ({ a, e, j })))
                        .slice(-2)
                        .map(({ a, e, j }) => (
                          <span
                            key={`${a.id}-${j}`}
                            className="chip-pop absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
                            style={{ animationDelay: `${a.stagger + 1800}ms`, background: C.signal, color: C.ink, fontWeight: 600, padding: "2px 8px" }}
                          >
                            {e.name}
                            {e.potId ? ` #${e.potId}` : ""}
                          </span>
                        ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* block strip */}
        <div>
          <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: "6px 20px", justifyContent: "space-between", fontSize: 15, color: C.muted }}>
            <span style={{ fontWeight: 600, color: C.ink }}>Latest Arc blocks</span>
            <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              <Legend color={C.grid} label="made" />
              <Legend color={C.ink} label="delivered by Streams" />
              <Legend color={C.signal} label="has a vault event" />
            </span>
          </div>
          <div style={{ display: "flex", gap: 3, overflow: "hidden" }}>
            {tiles.map((n) => (
              <span
                key={n}
                title={`block ${n}`}
                className="tile-in"
                style={{
                  height: 30,
                  minWidth: 0,
                  flex: 1,
                  transition: "background-color 500ms",
                  background: withEvents.has(n) ? C.signal : delivered.has(n) ? C.ink : C.grid,
                }}
              />
            ))}
          </div>
          <div style={{ marginTop: 4, display: "flex", justifyContent: "space-between", ...mono, fontSize: 12, color: C.muted }}>
            <span>{tiles[0]?.toLocaleString("en-US")}</span>
            <span>{tiles.at(-1)?.toLocaleString("en-US")}</span>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- stats */}
      <section className="grid grid-cols-2 lg:grid-cols-4" style={{ ...rule, gap: "24px 32px", paddingTop: 18 }}>
        <Stat label="Deliveries in 5 min" value={o.last5m.batches.toLocaleString("en-US")} hint={`${o.last5m.blocks.toLocaleString("en-US")} blocks covered`} />
        <Stat label="Block to HonorCat" value={fmtMs(o.last5m.p50LatencyMs)} hint={`median, slowest 5% ${fmtMs(o.last5m.p95LatencyMs)}`} />
        <Stat label="Behind the chain" value={o.behindBlocks !== null ? `${o.behindBlocks}` : "—"} hint="blocks not yet delivered" />
        <Stat label="Vault events in 5 min" value={o.last5m.vaultLogs.toLocaleString("en-US")} hint={`${(o.last5m.bytes / 1024).toFixed(1)} KB received`} />
      </section>

      <div className="grid lg:grid-cols-2" style={{ gap: "56px 48px" }}>
        {/* ---------------------------------------------------------------- deliveries */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <H2>Recent deliveries</H2>
          {arrivals.length === 0 ? (
            <p style={{ margin: 0, fontSize: 17, color: C.muted }}>None yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
              <thead style={{ textAlign: "left", color: C.muted }}>
                <tr>
                  <th style={{ paddingBottom: 6, fontWeight: 500 }}>Blocks</th>
                  <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>Delay</th>
                  <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>Size</th>
                  <th style={{ paddingBottom: 6, fontWeight: 500, textAlign: "right" }}>Vault events</th>
                </tr>
              </thead>
              <tbody>
                {arrivals
                  .slice(-12)
                  .reverse()
                  .map((a) => (
                    <tr
                      key={a.id}
                      style={{ ...row, background: a.seenAt && now - a.seenAt < 2500 ? "rgba(232, 66, 26, 0.18)" : undefined, transition: "background-color 600ms" }}
                    >
                      <td style={{ padding: "7px 0", ...mono, fontSize: 13 }}>
                        {a.start && a.start !== a.end ? `${Number(a.start).toLocaleString("en-US")}–` : ""}
                        {a.end ? Number(a.end).toLocaleString("en-US") : "—"}
                      </td>
                      <td style={{ padding: "7px 0", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmtMs(a.latencyMs)}</td>
                      <td style={{ padding: "7px 0", textAlign: "right", fontVariantNumeric: "tabular-nums", color: C.muted }}>
                        {a.bytes < 1024 ? `${a.bytes} B` : `${(a.bytes / 1024).toFixed(1)} KB`}
                        {a.gzip ? " gz" : ""}
                      </td>
                      <td style={{ padding: "7px 0", textAlign: "right" }}>
                        {a.logs > 0 ? (
                          <span style={{ fontWeight: 600, color: C.signalInk }}>{a.events.map((e) => e.name).join(", ")}</span>
                        ) : (
                          <span style={{ color: C.muted }}>0</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Delay is the time from the block until HonorCat received it.</p>
        </section>

        {/* ---------------------------------------------------------------- race */}
        <section style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
          <H2>Who saw each event first</H2>
          {totalSources > 0 && (
            <div>
              <div style={{ display: "flex", height: 10, overflow: "hidden", background: C.grid }}>
                {(["streams", "rpc", "receipt"] as const).map((k) =>
                  o.sources[k] ? <span key={k} style={{ background: sourceColor[k], width: `${(o.sources[k]! / totalSources) * 100}%` }} /> : null,
                )}
              </div>
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 15, color: C.muted }}>
                {(["streams", "rpc", "receipt"] as const).map((k) => (
                  <Legend key={k} color={sourceColor[k]} label={`${sourceLabel[k]} ${o.sources[k] ?? 0}`} />
                ))}
              </div>
            </div>
          )}
          <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: 15, borderBottom: `1px solid ${C.faint}` }}>
            {o.recentEvents.map((e) => (
              <li
                key={`${e.txHash}-${e.name}-${e.block}`}
                style={{ ...row, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "7px 0" }}
              >
                <span>
                  {e.name}
                  {e.potId && <span style={{ color: C.muted }}> · pot #{e.potId}</span>}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums", color: C.muted }}>{fmtMs(e.indexLagMs)}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600 }}>
                    <span style={{ width: 9, height: 9, background: sourceColor[e.source as keyof typeof sourceColor] ?? C.muted }} />
                    {sourceLabel[e.source as keyof typeof sourceLabel] ?? e.source}
                  </span>
                  <Tx hash={e.txHash} label="tx" />
                </span>
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45, color: C.muted }}>
            Three paths feed the same index: Streams pushes, the RPC poller pulls, and the relay reads its own receipts. The first to arrive counts; the
            others change nothing.
          </p>
        </section>
      </div>

      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <H2>What Streams does here</H2>
        <ul className="grid sm:grid-cols-2" style={{ margin: 0, padding: 0, listStyle: "none", gap: "20px 48px", fontSize: 17, lineHeight: 1.45 }}>
          {(
            [
              ["Push, not poll.", "QuickNode follows Arc block by block and sends each range in order. Failed deliveries are retried, so no block is skipped."],
              ["Filtered at the source.", "Our filter runs on QuickNode and keeps only the vault’s events, so each delivery is a few hundred bytes."],
              ["Signed.", "Every delivery carries a signature over its body. Anything else is rejected."],
              ["A clock for the relay.", "Each delivery wakes the relay, which settles pots and sends notices. No cron job, no open page."],
            ] as const
          ).map(([t, b]) => (
            <li key={t} style={{ display: "flex", gap: 12 }}>
              <CatHead width={18} height={17} style={{ marginTop: 4 }} />
              <span>
                <span style={{ fontWeight: 600 }}>{t}</span> <span style={{ color: C.body }}>{b}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const sourceColor = { streams: C.signal, rpc: C.dash, receipt: C.ink } as const;
const sourceLabel = { streams: "Streams", rpc: "RPC poller", receipt: "Relay receipt" } as const;

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 10, height: 10, background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 15, fontWeight: 600 }}>{label}</span>
      <span style={{ fontFamily: F.cond, fontSize: 64, fontWeight: 700, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      {hint && <span style={{ fontSize: 14, color: C.muted }}>{hint}</span>}
    </div>
  );
}
