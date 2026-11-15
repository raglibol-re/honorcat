"use client";

import { C, F } from "@/components/cat/tokens";
import { formatAxis } from "@/lib/format";

type Pt = { t: number; mid: number | null; status: number; signer: string };

/**
 * Probability over time, as the samplers saw it: each sampler's valid samples as a thin line
 * (raw), the smoothed value (time-weighted average over the trigger window, from the same valid
 * samples) as a thick line, the threshold as a dashed line, and the moment arming starts.
 * Invalid samples (wide spread, thin book, stale) are drawn as gaps.
 */
export function ProbabilityChart({
  samples,
  threshold,
  windowMs,
  armedAt,
  triggeredAt,
  height = 240,
  domain,
  range,
}: {
  samples: Pt[];
  threshold: number; // 0..1
  windowMs: number;
  armedAt: number; // ms
  triggeredAt?: number | null;
  height?: number;
  /** Fixed time range (ms), e.g. for a replay that reveals samples over time. */
  domain?: [number, number];
  /** Fixed probability range (0..1) for the y axis. */
  range?: [number, number];
}) {
  // A narrow viewBox keeps the labels readable when scaled down to a phone.
  const W = 480;
  const H = height;
  const pad = { l: 50, r: 10, t: 14, b: 34 };
  const FS = 17;
  const valid = samples.filter((s) => s.status === 0 && s.mid !== null);
  if (samples.length < 2) {
    return (
      <div className="flex items-center justify-center" style={{ height, fontSize: 15, background: C.panel, border: `1.5px solid ${C.ink}`, color: C.muted }}>
        Waiting for the first samples…
      </div>
    );
  }
  const t0 = domain?.[0] ?? Math.min(...samples.map((s) => s.t));
  const t1 = domain?.[1] ?? Math.max(...samples.map((s) => s.t), t0 + 1);
  const mids = valid.map((s) => s.mid!);
  const lo = range?.[0] ?? Math.max(0, Math.min(threshold - 0.1, ...mids) - 0.02);
  const hi = range?.[1] ?? Math.min(1, Math.max(threshold + 0.05, ...mids) + 0.02);
  const x = (t: number) => pad.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - pad.l - pad.r);
  const y = (p: number) => pad.t + (1 - (p - lo) / Math.max(0.0001, hi - lo)) * (H - pad.t - pad.b);

  // Raw lines per sampler, broken at invalid samples.
  const bySigner = new Map<string, Pt[]>();
  for (const s of samples) bySigner.set(s.signer, [...(bySigner.get(s.signer) ?? []), s]);
  const rawPaths = [...bySigner.values()].map((pts) => {
    let d = "";
    let pen = false;
    for (const s of pts.sort((a, b) => a.t - b.t)) {
      if (s.status !== 0 || s.mid === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${x(s.t).toFixed(1)},${y(s.mid).toFixed(1)}`;
      pen = true;
    }
    return d;
  });

  // Smoothed: trailing time-weighted average of valid samples (all samplers pooled for display).
  const pooled = [...valid].sort((a, b) => a.t - b.t);
  let smooth = "";
  for (let i = 0; i < pooled.length; i++) {
    const end = pooled[i]!.t;
    if (end - windowMs < armedAt - windowMs) continue;
    let w = 0;
    let acc = 0;
    for (let j = i; j >= 0 && pooled[j]!.t > end - windowMs; j--) {
      const until = j === i ? end : pooled[j + 1]!.t;
      const dt = Math.max(0, until - pooled[j]!.t) || 1;
      w += dt;
      acc += pooled[j]!.mid! * dt;
    }
    if (w > 0) smooth += `${smooth ? "L" : "M"}${x(end).toFixed(1)},${y(acc / w).toFixed(1)}`;
  }

  const ticks = [...new Set([lo, hi].map((p) => Math.round(p * 100)))].filter((p) => Math.abs(p - threshold * 100) >= 3);
  const xTicks = [t0, (t0 + t1) / 2, t1];
  const grid: number[] = [];
  for (let g = Math.ceil(lo * 20) / 20; g <= hi; g += 0.05) grid.push(g);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: "auto", display: "block", background: C.panel, border: `1.5px solid ${C.ink}` }}
      role="img"
      aria-label={`Probability chart, threshold ${Math.round(threshold * 100)}%`}
    >
      {grid.map((g) => (
        <line key={g} x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth="1" />
      ))}
      <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke={C.ink} strokeWidth="1.5" />
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={C.ink} strokeWidth="1.5" />
      {ticks.map((p) => (
        <text key={p} x={pad.l - 6} y={y(p / 100) + 6} textAnchor="end" fontSize={FS} style={{ fontFamily: F.cond }} fill={C.muted}>
          {p}%
        </text>
      ))}
      {xTicks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={FS} style={{ fontFamily: F.cond }} fill={C.muted}>
          {formatAxis(t, t1 - t0)}
        </text>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke={C.signal} strokeWidth="3" />
      <text x={pad.l - 6} y={y(threshold) + 6} textAnchor="end" fontSize={FS} fontWeight="600" style={{ fontFamily: F.sans }} fill={C.signalInk}>
        {Math.round(threshold * 100)}%
      </text>
      {armedAt > t0 && armedAt < t1 && (
        <g>
          <line x1={x(armedAt)} x2={x(armedAt)} y1={pad.t} y2={H - pad.b} stroke={C.dash} strokeWidth="1.5" strokeDasharray="4 4" />
          <text x={x(armedAt) + 5} y={pad.t + FS} fontSize={FS} style={{ fontFamily: F.cond }} fill={C.muted}>
            watching
          </text>
        </g>
      )}
      {rawPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={C.dash} strokeWidth="1" opacity="0.7" />
      ))}
      <path d={smooth} fill="none" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {triggeredAt && triggeredAt > t0 && (
        <circle cx={x(Math.min(triggeredAt, t1))} cy={y(threshold)} r="6" fill={C.signal} stroke={C.ink} strokeWidth="2" />
      )}
    </svg>
  );
}
