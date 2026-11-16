"use client";

import { useMemo, useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { HcPot } from "@/lib/hc";

type Point = { t: number; p: number };
type Mark = { t: number; p: number; label: string; kind: "entry" | "exit" | "handshake" | "settle" };

const W = 800;
const H = 260;
const PAD = { l: 44, r: 16, t: 18, b: 34 };

/**
 * A row (0 above, 1 below, 2 higher, 3 lower) for each label at x, so labels closer than 130 px
 * never share a row.
 */
function labelRows(xs: number[]): number[] {
  const last = [-1e9, -1e9, -1e9, -1e9];
  return xs.map((x) => {
    const row = last.findIndex((l) => x - l >= 130);
    const r = row === -1 ? 0 : row;
    last[r] = x;
    return r;
  });
}

/** The marks from the pot's own events: the entry, every exit (partial ones named), handshakes, the settlement. */
function marksOf(pot: HcPot): Mark[] {
  const out: Mark[] = [];
  let size = 0n;
  for (const e of pot.events ?? []) {
    const g = e.args;
    const t = (e.at ?? 0) * 1000;
    if (!t) continue;
    if (e.name === "PotCreated") size = BigInt(g.notional ?? "0");
    if (e.name === "Joined") out.push({ t, p: Number(g.entryPrice) / 1e6, label: "entry", kind: "entry" });
    if (e.name === "PotDivided") {
      const n = BigInt(g.notional ?? "0");
      out.push({ t, p: Number(g.price) / 1e6, label: n < size ? "partial exit" : "exit", kind: "exit" });
      size -= n;
    }
    if (e.name === "TakenOver") out.push({ t, p: Number(g.price) / 1e6, label: "takeover", kind: "exit" });
    if (e.name === "Handshake") out.push({ t, p: Number(g.price) / 1e6, label: "handshake", kind: "handshake" });
    if (e.name === "PotSettled" && Number(g.outcome) !== 2) out.push({ t, p: Number(g.outcome) === 1 ? 1 : 0, label: "settled", kind: "settle" });
  }
  return out;
}

/**
 * The pot's price over time (Gemini's candles for its contract) with the entry, every exit and the
 * settlement marked. One series, so no legend: the marks are labelled where they sit. Hover shows the
 * time and the chance; a table view lists the marks for screen readers and print.
 */
export function PriceChart({ pot }: { pot: HcPot }) {
  const { data } = usePolling<{ points: Point[] }>(`/api/hc/pots/${pot.potId}/history`, 60_000);
  const [hover, setHover] = useState<Point | null>(null);
  const marks = useMemo(() => marksOf(pot), [pot]);
  // The line starts at the entry: candles before it are not this pot's history.
  const entryT = marks.find((m) => m.kind === "entry")?.t ?? null;
  const points = (data?.points ?? []).filter((q) => entryT === null || q.t >= entryT - 60_000);
  if (!data) return null;
  if (points.length < 2 && !marks.length) return null;
  // Where Gemini's candles do not reach back to the entry, say so instead of drawing a guess.
  const gapFrom = entryT !== null && (points.length === 0 || points[0]!.t - entryT > 10 * 60_000) ? entryT : null;
  const gapTo = gapFrom !== null ? (points[0]?.t ?? null) : null;

  const ts = [...points.map((x) => x.t), ...marks.map((m) => m.t)];
  const ps = [...points.map((x) => x.p), ...marks.map((m) => m.p)];
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts, t0 + 60_000);
  const lo = Math.max(0, Math.floor((Math.min(...ps) - 0.05) * 20) / 20);
  const hi = Math.min(1, Math.ceil((Math.max(...ps) + 0.05) * 20) / 20);
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - lo) / Math.max(0.01, hi - lo)) * (H - PAD.t - PAD.b);
  const path = points.map((q, i) => `${i ? "L" : "M"}${x(q.t).toFixed(1)},${y(q.p).toFixed(1)}`).join(" ");
  const grid = Array.from({ length: Math.round((hi - lo) / 0.05) + 1 }, (_, i) => lo + i * 0.05).filter((v, i, a) => a.length <= 6 || i % 2 === 0);
  const pct = (p: number) => `${(p * 100).toFixed(1)}%`;
  const color = (k: Mark["kind"]) => (k === "exit" || k === "handshake" ? C.signal : C.ink);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!points.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const tx = t0 + (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * (t1 - t0);
    let best = points[0]!;
    for (const q of points) if (Math.abs(q.t - tx) < Math.abs(best.t - tx)) best = q;
    setHover(best);
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>The price so far</h2>
      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label={`The chance over time, from ${pct(points[0]?.p ?? 0)} to ${pct(points.at(-1)?.p ?? 0)}, with ${marks.length} marked events (see the table below).`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          style={{ display: "block", touchAction: "none" }}
        >
          {grid.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={C.grid} strokeWidth="1" />
              <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end" fontSize="12" fill={C.muted} fontFamily="var(--font-barlow), Arial, sans-serif">
                {Math.round(v * 100)}%
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 8} fontSize="12" fill={C.muted} fontFamily="var(--font-barlow), Arial, sans-serif">
            {formatDate(t0)}
          </text>
          <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize="12" fill={C.muted} fontFamily="var(--font-barlow), Arial, sans-serif">
            {formatDate(t1)}
          </text>
          {gapFrom !== null && (
            <g>
              <line x1={x(gapFrom)} x2={gapTo !== null ? x(gapTo) : W - PAD.r} y1={y(marks[0]!.p)} y2={gapTo !== null ? y(points[0]!.p) : y(marks[0]!.p)} stroke={C.dash} strokeWidth="1.5" strokeDasharray="4 5" />
            </g>
          )}
          <path d={path} fill="none" stroke={C.ink} strokeWidth="2" strokeLinejoin="round" />
          {labelRows(marks.map((m) => x(m.t))).map((row, i) => {
            const m = marks[i]!;
            // Labels are placed in rows above and below the line so two never overlap.
            const dy = [-12, 24, -30, 42][row]!;
            const flip = y(m.p) + dy < PAD.t + 4 ? 24 : y(m.p) + dy > H - PAD.b - 2 ? -12 : dy;
            return (
            <g key={i}>
              <circle cx={x(m.t)} cy={y(m.p)} r="6" fill={color(m.kind)} stroke={C.page} strokeWidth="2" />
              <text
                x={Math.min(Math.max(x(m.t), PAD.l + 40), W - PAD.r - 40)}
                y={y(m.p) + flip}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill={C.ink}
                fontFamily="var(--font-barlow), Arial, sans-serif"
              >
                {m.label} {pct(m.p)}
              </text>
            </g>
            );
          })}
          {hover && (
            <g pointerEvents="none">
              <line x1={x(hover.t)} x2={x(hover.t)} y1={PAD.t} y2={H - PAD.b} stroke={C.dash} strokeWidth="1" />
              <circle cx={x(hover.t)} cy={y(hover.p)} r="4" fill={C.ink} />
            </g>
          )}
        </svg>
        {hover && (
          <div
            role="status"
            style={{
              position: "absolute",
              top: 0,
              left: `${(x(hover.t) / W) * 100}%`,
              transform: `translateX(${x(hover.t) > W / 2 ? "-105%" : "5%"})`,
              background: C.page,
              border: `1px solid ${C.ink}`,
              padding: "4px 8px",
              fontSize: 13,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            {formatDate(hover.t)}: <strong>{pct(hover.p)}</strong>
          </div>
        )}
      </div>
      {gapFrom !== null && (
        <p style={{ margin: 0, fontSize: 14, color: C.body }}>
          Gemini&apos;s price history for this market does not reach back to the entry: the dashed part from {formatDate(gapFrom)}
          {gapTo !== null ? ` to ${formatDate(gapTo)}` : ""} has no recorded prices, only the marked events.
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, fontSize: 13, color: C.muted }}>
        <span>Gemini&apos;s last traded price per {points.length > 1 && points[1]!.t - points[0]!.t >= 3_600_000 ? "hour" : "few minutes"}; the pot itself uses 30-second averages.</span>
        <span>Data provided by Gemini.</span>
      </div>
      <details>
        <summary style={{ cursor: "pointer", fontSize: 15, minHeight: 32 }}>Show the marked events as a table</summary>
        <table style={{ borderCollapse: "collapse", fontSize: 15, marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "4px 12px 4px 0" }}>When</th>
              <th style={{ textAlign: "left", padding: "4px 12px 4px 0" }}>What</th>
              <th style={{ textAlign: "right", padding: "4px 0" }}>Chance</th>
            </tr>
          </thead>
          <tbody>
            {marks.map((m, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${C.faint}` }}>
                <td style={{ padding: "4px 12px 4px 0" }}>{formatDate(m.t)}</td>
                <td style={{ padding: "4px 12px 4px 0" }}>{m.label}</td>
                <td style={{ padding: "4px 0", textAlign: "right" }}>{pct(m.p)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
