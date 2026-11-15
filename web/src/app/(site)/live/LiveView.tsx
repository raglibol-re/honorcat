"use client";

import { useEffect, useRef, useState } from "react";
import { getJson } from "@/lib/api";
import { useNow } from "@/lib/useNow";
import { Card, Tx } from "@/components/ui";

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
  { key: "arc", title: "Arc testnet", sub: "new block every ~0.5 s" },
  { key: "qn", title: "QuickNode Streams", sub: "runs our filter per block range" },
  { key: "hook", title: "Webhook", sub: "HMAC-verified, gzip ok" },
  { key: "relay", title: "Relay", sub: "index · webhooks · tick" },
  { key: "vault", title: "Vault & ledger", sub: "settle, pay out, refund" },
] as const;

export function LiveView() {
  const { overview: o, arrivals, fetchedAt, error } = useStreamFeed();
  const now = useNow();

  if (error && !o) return <p className="text-sm text-negative">{error}</p>;
  if (!o) return <p className="text-sm text-muted">Connecting…</p>;

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
    <div className="space-y-6">
      {!o.configured && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Push delivery is off on this deployment. Chain events are read directly from Arc instead.
        </p>
      )}
      {o.configured && !o.lastBatch && (
        <p className="rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          Waiting for the next delivery from QuickNode.
        </p>
      )}

      {/* ---------------------------------------------------------------- pipeline */}
      <Card
        title="Pipeline"
        right={
          <span className={`flex items-center gap-2 text-xs ${healthy ? "text-positive" : "text-muted"}`}>
            <span className={`h-2 w-2 rounded-full ${healthy ? "animate-pulse bg-positive" : "bg-border"}`} />
            {healthy ? `streaming · last delivery ${fmtMs(lastAge)} ago` : o.lastBatch ? `last delivery ${fmtAge(lastAge)} ago` : "waiting for the next delivery"}
          </span>
        }
      >
        <div className="relative px-2 pb-2 pt-1 sm:px-6">
          {/* track */}
          <div className="absolute left-[10%] right-[10%] top-[26px] h-px bg-border" />
          <div className="absolute left-[10%] right-[10%] top-[26px] h-0">
            {inFlight.map((a) => {
              const toVault = a.logs > 0;
              return (
                <span
                  key={a.id}
                  className={`packet block rounded-full ${toVault ? "h-3 w-3 bg-accent shadow-[0_0_0_4px_rgba(31,79,209,0.15)]" : "h-2 w-2 bg-muted/70"}`}
                  style={
                    {
                      "--dur": toVault ? "2200ms" : "1500ms",
                      animationName: toVault ? "packet-travel" : "packet-travel-short",
                      animationDelay: `${a.stagger}ms`,
                    } as React.CSSProperties
                  }
                  title={`batch ${a.start ?? "?"}–${a.end ?? "?"}`}
                />
              );
            })}
          </div>
          {/* stages */}
          <ol className="relative grid grid-cols-5 gap-1 sm:gap-3">
            {STAGES.map((s, i) => {
              const pingKey = s.key === "vault" ? lastEventArrival?.id : lastArrival?.id;
              return (
                <li key={s.key} className="flex flex-col items-center text-center">
                  <span className="relative flex h-[52px] w-[52px] items-center justify-center rounded-full border border-border bg-surface text-xs font-semibold">
                    {pingKey && <span key={`${s.key}-${pingKey}`} className="stage-ping absolute inset-0 rounded-full" style={{ animationDelay: `${i * 300}ms` }} />}
                    {i + 1}
                  </span>
                  <span className="mt-2 text-xs font-medium sm:text-sm">{s.title}</span>
                  <span className="hidden text-xs text-muted sm:block">{s.sub}</span>
                  {s.key === "arc" && <span className="mt-1 font-mono text-[11px] text-muted">#{head ? head.toLocaleString("en-US") : "—"}</span>}
                  {s.key === "qn" && <span className="mt-1 text-[11px] text-muted">{o.last5m.batches} batches / 5 min</span>}
                  {s.key === "hook" && <span className="mt-1 text-[11px] text-muted">p50 {fmtMs(o.last5m.p50LatencyMs)}</span>}
                  {s.key === "relay" && <span className="mt-1 text-[11px] text-muted">{o.primary === "streams" ? "Streams primary" : "Streams + RPC fallback"}</span>}
                  {s.key === "vault" && (
                    <span className="relative mt-1 h-5 text-[11px]">
                      {inFlight
                        .filter((a) => a.logs > 0)
                        .flatMap((a) => a.events.map((e, j) => ({ a, e, j })))
                        .slice(-2)
                        .map(({ a, e, j }) => (
                          <span
                            key={`${a.id}-${j}`}
                            className="chip-pop absolute left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-accent px-2 py-0.5 text-white"
                            style={{ animationDelay: `${a.stagger + 1800}ms` }}
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
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-xs text-muted">
            <span>Latest Arc blocks</span>
            <span className="flex items-center gap-3">
              <Legend cls="bg-border" label="produced" />
              <Legend cls="bg-muted/50" label="delivered by Streams" />
              <Legend cls="bg-accent" label="contains a vault event" />
            </span>
          </div>
          <div className="flex gap-[3px] overflow-hidden">
            {tiles.map((n) => (
              <span
                key={n}
                title={`block ${n}`}
                className={`tile-in h-7 min-w-0 flex-1 rounded-sm transition-colors duration-500 ${
                  withEvents.has(n) ? "bg-accent" : delivered.has(n) ? "bg-muted/50" : "bg-border"
                }`}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
            <span>{tiles[0]?.toLocaleString("en-US")}</span>
            <span>{tiles.at(-1)?.toLocaleString("en-US")}</span>
          </div>
        </div>
      </Card>

      {/* ---------------------------------------------------------------- stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Deliveries (5 min)" value={o.last5m.batches.toLocaleString("en-US")} hint={`${o.last5m.blocks.toLocaleString("en-US")} blocks covered`} />
        <Stat label="Block → Verdict" value={fmtMs(o.last5m.p50LatencyMs)} hint={`median · p95 ${fmtMs(o.last5m.p95LatencyMs)}`} />
        <Stat label="Behind chain head" value={o.behindBlocks !== null ? `${o.behindBlocks} blocks` : "—"} hint="head minus last delivered block" />
        <Stat label="Vault logs (5 min)" value={o.last5m.vaultLogs.toLocaleString("en-US")} hint={`${(o.last5m.bytes / 1024).toFixed(1)} KB received`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------------------------------------------------------- deliveries */}
        <Card title="Recent deliveries">
          {arrivals.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="pb-2 font-medium">Blocks</th>
                  <th className="pb-2 text-right font-medium">Delay</th>
                  <th className="pb-2 text-right font-medium">Size</th>
                  <th className="pb-2 text-right font-medium">Vault logs</th>
                </tr>
              </thead>
              <tbody>
                {arrivals
                  .slice(-12)
                  .reverse()
                  .map((a) => (
                    <tr key={a.id} className={`border-t border-border ${a.seenAt && now - a.seenAt < 2500 ? "bg-accent/5" : ""}`}>
                      <td className="py-1.5 font-mono text-xs">
                        {a.start && a.start !== a.end ? `${Number(a.start).toLocaleString("en-US")}–` : ""}
                        {a.end ? Number(a.end).toLocaleString("en-US") : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmtMs(a.latencyMs)}</td>
                      <td className="py-1.5 text-right tabular-nums text-muted">
                        {a.bytes < 1024 ? `${a.bytes} B` : `${(a.bytes / 1024).toFixed(1)} KB`}
                        {a.gzip ? " gz" : ""}
                      </td>
                      <td className="py-1.5 text-right">
                        {a.logs > 0 ? (
                          <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-white">
                            {a.events.map((e) => e.name).join(", ")}
                          </span>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted">
            Delay = time from the block&apos;s timestamp until Verdict received it (QuickNode processing + HTTP delivery).
          </p>
        </Card>

        {/* ---------------------------------------------------------------- race */}
        <Card title="Who indexed each event first">
          {totalSources > 0 && (
            <div className="mb-4">
              <div className="flex h-2 overflow-hidden rounded-full bg-border">
                {(["streams", "rpc", "receipt"] as const).map((k) =>
                  o.sources[k] ? <span key={k} className={sourceColor[k]} style={{ width: `${(o.sources[k]! / totalSources) * 100}%` }} /> : null,
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted">
                {(["streams", "rpc", "receipt"] as const).map((k) => (
                  <Legend key={k} cls={sourceColor[k]} label={`${sourceLabel[k]} ${o.sources[k] ?? 0}`} />
                ))}
              </div>
            </div>
          )}
          <ul className="divide-y divide-border text-sm">
            {o.recentEvents.map((e) => (
              <li key={`${e.txHash}-${e.name}-${e.block}`} className="flex items-center justify-between gap-3 py-1.5">
                <span>
                  {e.name}
                  {e.potId && <span className="text-muted"> · pot #{e.potId}</span>}
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs tabular-nums text-muted">{fmtMs(e.indexLagMs)}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] text-white ${sourceColor[e.source as keyof typeof sourceColor] ?? "bg-muted"}`}>
                    {sourceLabel[e.source as keyof typeof sourceLabel] ?? e.source}
                  </span>
                  <Tx hash={e.txHash} label="tx" />
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Three paths feed the same idempotent index: Streams (push), the RPC poller (pull on each tick), and the relay&apos;s own
            transaction receipts. The first one to arrive wins; the others are no-ops.
          </p>
        </Card>
      </div>

      <Card title="What QuickNode Streams does here">
        <ul className="grid gap-4 text-sm sm:grid-cols-2">
          <li>
            <span className="font-medium">Push instead of poll.</span>{" "}
            <span className="text-muted">QuickNode follows Arc block by block and sends us each range in order, retrying failed deliveries, so no block is skipped.</span>
          </li>
          <li>
            <span className="font-medium">Filtering at the source.</span>{" "}
            <span className="text-muted">Our JavaScript filter runs on QuickNode and keeps only the vault&apos;s logs, so deliveries stay a few hundred bytes.</span>
          </li>
          <li>
            <span className="font-medium">Authenticity.</span>{" "}
            <span className="text-muted">Every request carries an HMAC-SHA256 signature over nonce, timestamp and body; anything else is rejected with 401.</span>
          </li>
          <li>
            <span className="font-medium">A clock for a serverless relay.</span>{" "}
            <span className="text-muted">Each delivery wakes the relay on Vercel, which settles pots and sends webhooks, without a cron job or an open page.</span>
          </li>
        </ul>
      </Card>
    </div>
  );
}

const sourceColor = { streams: "bg-accent", rpc: "bg-amber-500", receipt: "bg-positive" } as const;
const sourceLabel = { streams: "Streams", rpc: "RPC poller", receipt: "Relay receipt" } as const;

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}
