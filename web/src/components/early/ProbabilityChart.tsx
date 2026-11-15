"use client";

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
  height = 180,
}: {
  samples: Pt[];
  threshold: number; // 0..1
  windowMs: number;
  armedAt: number; // ms
  triggeredAt?: number | null;
  height?: number;
}) {
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 8, t: 14, b: 28 };
  const valid = samples.filter((s) => s.status === 0 && s.mid !== null);
  if (samples.length < 2) {
    return (
      <div className="t-13 flex items-center justify-center rounded-lg border" style={{ height, borderColor: "var(--vg-rule)", color: "var(--vg-muted)" }}>
        Waiting for the first samples…
      </div>
    );
  }
  const t0 = Math.min(...samples.map((s) => s.t));
  const t1 = Math.max(...samples.map((s) => s.t), t0 + 1);
  const mids = valid.map((s) => s.mid!);
  const lo = Math.max(0, Math.min(threshold - 0.1, ...mids) - 0.02);
  const hi = Math.min(1, Math.max(threshold + 0.05, ...mids) + 0.02);
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

  const ticks = [lo, threshold, hi].map((p) => Math.round(p * 100));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Probability chart, threshold ${Math.round(threshold * 100)}%`}>
      {ticks.map((p) => (
        <text key={p} x={pad.l - 8} y={y(p / 100) + 6} textAnchor="end" fontSize="20" fill="var(--vg-muted)">
          {p}%
        </text>
      ))}
      <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke="var(--vg-ink)" strokeDasharray="4 4" strokeWidth="1" opacity="0.7" />
      {armedAt > t0 && armedAt < t1 && (
        <g>
          <line x1={x(armedAt)} x2={x(armedAt)} y1={pad.t} y2={H - pad.b} stroke="var(--vg-rule)" strokeWidth="1" />
          <text x={x(armedAt) + 6} y={H - 6} fontSize="20" fill="var(--vg-muted)">
            armed
          </text>
        </g>
      )}
      {rawPaths.map((d, i) => (
        <path key={i} d={d} fill="none" stroke="var(--vg-muted)" strokeWidth="1" opacity="0.6" />
      ))}
      <path d={smooth} fill="none" stroke="var(--vg-accent)" strokeWidth="2.5" />
      {triggeredAt && triggeredAt > t0 && (
        <circle cx={x(Math.min(triggeredAt, t1))} cy={y(threshold)} r="5" fill="var(--vg-accent)" stroke="var(--vg-card)" strokeWidth="2" />
      )}
    </svg>
  );
}
