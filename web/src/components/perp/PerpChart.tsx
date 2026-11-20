"use client";

import { useEffect, useRef, useState } from "react";
import { C, F } from "@/components/cat/tokens";
import { More } from "@/components/ui/More";
import { getCandles, type RopeStory } from "@/lib/perp";

const H = 240;
const PAD = { l: 44, r: 14, t: 18, b: 28 };

/** When a rope stopped (or now, for the running one). */
export function ropeEnd(r: RopeStory, next: RopeStory | undefined, now: number) {
  if (r.decided && r.decided.kind !== "entry") return r.decided.windowEnd;
  if (next?.armedAt) return next.armedAt;
  return Math.min(now, r.expiry || now);
}

const hhmm = (s: number) =>
  new Date(s * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The market's price over the perp's life, with each rope's posts as a band and a mark where each
 * rope ended (filled red: knocked out at a post). The main line joins the samplers' 30-second prices
 * (the middle of the book, what the ropes use). Gemini's last trade per minute, which can lag far
 * behind on a quiet market, is drawn only when the viewer asks for it, with its own label.
 */
export function PerpChart({
  symbol,
  ropes,
  now,
  live,
}: {
  symbol: string;
  ropes: RopeStory[];
  now: number;
  /** The live middle of the book (0 to 1), drawn as a dot at the right edge while a rope runs. */
  live: number | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [candles, setCandles] = useState<[number, number][] | null>(null);
  const [failed, setFailed] = useState(false);
  const [trades, setTrades] = useState(false);
  const nowS = Math.floor(now / 1000);
  const first = ropes.find((r) => r.armedAt > 0)?.armedAt ?? 0;
  const since = first ? first - 600 : nowS - 3600;
  const lastEnd = ropes.length ? ropeEnd(ropes.at(-1)!, undefined, nowS) : nowS;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!trades) return;
    let alive = true;
    const load = () =>
      getCandles(symbol, since)
        .then((r) => {
          if (!alive) return;
          setCandles(r.candles);
          setFailed(false);
        })
        .catch(() => alive && setFailed(true));
    void load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, since, trades]);

  const x0 = since;
  const x1 = Math.max(lastEnd, nowS) + 120;
  const pts = trades ? (candles ?? []).filter((c) => c[0] >= x0 && c[0] <= x1) : [];
  // The main line: every 30-second price the samplers measured, in time order.
  const measured = ropes
    .flatMap((r) => r.checks)
    .filter((c) => c[0] >= x0 && c[0] <= x1)
    .sort((a, b) => a[0] - b[0]);
  const values = [
    ...pts.map((c) => c[1]),
    ...ropes.flatMap((r) => (r.lower || r.upper ? [r.lower / 1e6, r.upper / 1e6] : [])),
    ...(live !== null ? [live] : []),
    ...ropes.flatMap((r) => r.checks.map((c) => c[1] / 1e6)),
  ];
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  const padY = Math.max(0.02, (hi - lo) * 0.1);
  lo = Math.max(0, lo - padY);
  hi = Math.min(1, hi + padY);
  const iw = Math.max(10, w - PAD.l - PAD.r);
  const ih = H - PAD.t - PAD.b;
  const X = (t: number) => PAD.l + ((t - x0) / Math.max(1, x1 - x0)) * iw;
  const Y = (p: number) => PAD.t + (1 - (p - lo) / Math.max(1e-6, hi - lo)) * ih;
  const step = hi - lo > 0.4 ? 0.1 : hi - lo > 0.15 ? 0.05 : 0.02;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(4)));
  const line = pts.map((c, i) => `${i ? "L" : "M"}${X(c[0]).toFixed(1)},${Y(c[1]).toFixed(1)}`).join(" ");
  const mainLine = measured.map((c, i) => `${i ? "L" : "M"}${X(c[0]).toFixed(1)},${Y(c[1] / 1e6).toFixed(1)}`).join(" ");

  const summary = ropes
    .map((r, i) => {
      const how =
        r.decided?.kind === "post"
          ? "knocked out at a post"
          : r.decided?.kind === "expiry"
            ? "divided at its end"
            : r.decided?.kind === "exit"
              ? "divided when someone left"
              : i === ropes.length - 1
                ? "running"
                : "ended";
      return `Rope ${r.rope}: posts ${(r.lower / 1e4).toFixed(0)} and ${(r.upper / 1e4).toFixed(0)}, ${how}`;
    })
    .join("; ");

  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div ref={box} style={{ width: "100%", background: C.panel, border: `1.5px solid ${C.ink}` }}>
        {w > 0 && (
          <svg
            width={w}
            height={H}
            role="img"
            aria-label={`Price chart of the market with each rope's posts. ${summary}.`}
            style={{ display: "block", fontFamily: F.sans }}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line x1={PAD.l} x2={w - PAD.r} y1={Y(v)} y2={Y(v)} stroke={C.grid} />
                <text x={PAD.l - 6} y={Y(v) + 4} textAnchor="end" fontSize={12} fill={C.muted}>
                  {Math.round(v * 100)}
                </text>
              </g>
            ))}
            {ropes.map((r, i) => {
              if (!r.armedAt || !(r.upper > r.lower)) return null;
              const end = ropeEnd(r, ropes[i + 1], nowS);
              const xa = X(r.armedAt);
              const xb = Math.max(xa + 2, X(end));
              const yu = Y(r.upper / 1e6);
              const yl = Y(r.lower / 1e6);
              const knocked = r.decided?.kind === "post";
              const p = r.decided && r.decided.kind !== "entry" ? r.decided.priceYes : null;
              return (
                <g key={r.rope}>
                  <rect x={xa} y={yu} width={xb - xa} height={Math.max(1, yl - yu)} fill={C.page} />
                  <line x1={xa} x2={xb} y1={yu} y2={yu} stroke={C.ink} strokeWidth={1.5} strokeDasharray="5 3" />
                  <line x1={xa} x2={xb} y1={yl} y2={yl} stroke={C.ink} strokeWidth={1.5} strokeDasharray="5 3" />
                  <line x1={xa} x2={xa} y1={yu} y2={yl} stroke={C.dash} />
                  {xb - xa > 34 && (
                    <text x={xa + 4} y={yu - 5} fontSize={12} fontWeight={600} fill={C.ink}>
                      Rope {r.rope}
                    </text>
                  )}
                  {p !== null && (
                    <circle
                      cx={xb}
                      cy={Y(p / 1e6)}
                      r={5}
                      fill={knocked ? C.signal : C.page}
                      stroke={knocked ? C.signal : C.ink}
                      strokeWidth={2}
                    />
                  )}
                </g>
              );
            })}
            {line && <path d={line} fill="none" stroke={C.dash} strokeWidth={1.5} strokeDasharray="2 3" strokeLinejoin="round" />}
            {mainLine && <path d={mainLine} fill="none" stroke={C.ink} strokeWidth={2} strokeLinejoin="round" />}
            {ropes.flatMap((r) =>
              r.checks
                .filter((c) => c[0] >= x0 && c[0] <= x1)
                .map((c, i) => (
                  <rect key={`${r.rope}-${i}`} x={X(c[0]) - 2.5} y={Y(c[1] / 1e6) - 2.5} width={5} height={5} fill={C.ink} />
                )),
            )}
            {live !== null && (
              <circle cx={X(nowS)} cy={Y(live)} r={5} fill={C.ink}>
                <animate attributeName="r" values="4;6;4" dur="2s" repeatCount="indefinite" />
              </circle>
            )}
            <text x={PAD.l} y={H - 8} fontSize={12} fill={C.muted}>
              {hhmm(x0)}
            </text>
            <text x={w - PAD.r} y={H - 8} fontSize={12} fill={C.muted} textAnchor="end">
              {hhmm(x1)}
            </text>
          </svg>
        )}
      </div>
      <figcaption style={{ fontSize: 14, color: C.muted, lineHeight: 1.45 }}>
        {trades && failed && !candles ? "Gemini's trade history did not load. " : ""}
        Dashed lines: each rope&apos;s posts. Red dot: knocked out.
        <More label="How to read the chart" style={{ margin: "4px 0 0" }}>
          <span>
            Black line and squares: the 30-second prices the samplers measured for the ropes (the middle of
            the order book, YES, in points), the prices the ropes use. Dashed: each rope&apos;s posts. A red
            dot marks a knock-out at a post; a white dot the price a rope was divided at.
          </span>
          <label style={{ display: "inline-flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
            <input type="checkbox" checked={trades} onChange={(e) => setTrades(e.target.checked)} />
            Also show Gemini&apos;s last trade each minute (dotted grey; on a quiet market it can lag far behind the book)
          </label>
        </More>
      </figcaption>
    </figure>
  );
}
