import { CatHeadShape, Paw } from "./shapes";
import { C, F } from "./tokens";

export type SeriesPoint = { t: number; p: number }; // t ms, p 0..1

/**
 * The chance over time from the landing reference (viewBox 1000×340, panel #F6F4EE with a 1.5px
 * ink border): grid, the threshold in signal colour, the real series in ink, a paw print where it
 * paid with the stamp, and the cat head at the end. The y axis keeps the reference scale (100 at
 * the top, 7 units per point) when the data fits; otherwise it stretches to fit.
 */
export function PounceChart({
  series,
  threshold,
  paidAt,
  endLabel,
  ariaLabel,
  width = 1000,
}: {
  series: SeriesPoint[];
  threshold: number;
  paidAt: number | null;
  endLabel: string;
  ariaLabel: string;
  /** viewBox width: 1000 as in the reference; narrower on phones keeps the labels readable. */
  width?: number;
}) {
  const W = width;
  const pts = [...series].sort((a, b) => a.t - b.t);
  const minP = Math.min(threshold * 100, ...pts.map((s) => s.p * 100));
  const lo = minP >= 58 ? 55 : Math.max(0, Math.floor((minP - 3) / 5) * 5);
  const k = 315 / (100 - lo);
  const y = (p: number) => 20 + (100 - p * 100) * k;
  const t0 = pts[0]?.t ?? 0;
  const t1 = Math.max(pts.at(-1)?.t ?? t0 + 1, paidAt ?? 0, t0 + 1);
  const x = (t: number) => 44 + ((t - t0) / (t1 - t0)) * (W - 34 - 44);

  const vLines = Array.from({ length: Math.floor((W - 1) / 40) }, (_, i) => 40 + i * 40);
  const hLines: number[] = [];
  for (let p = 100; p >= lo; p -= 5) hLines.push(20 + (100 - p) * k);
  const labels: number[] = [];
  for (let p = 100; p >= lo + 15; p -= 10) labels.push(p);
  const ty = y(threshold);

  const end = pts.at(-1);
  const ex = end ? x(end.t) : W - 34;
  const ey = end ? y(end.p) : ty;

  const px = paidAt === null ? null : x(paidAt);
  // The paw marks the line itself at the moment it paid: on the threshold where the line crosses
  // it, higher when the chance was already above it for the whole window.
  const atPaid = paidAt === null || !pts.length ? null : pts.reduce((b, s) => (Math.abs(s.t - paidAt) < Math.abs(b.t - paidAt) ? s : b), pts[0]!);
  const my = atPaid ? Math.min(y(Math.max(threshold, atPaid.p)), ty) : ty;
  // The stamp sits above the paw as in the reference; below it when there is no room at the top.
  const above = my - 99 >= 0;
  const d = above ? -1 : 1; // direction from the paw to the stamp
  const sy = my + d * 75; // stamp centre
  // Keep the stamp clear of the cat head and its label at the end of the line.
  const endLeft = ex - 12 - endLabel.length * 9;
  const sx = px === null ? 0 : Math.max(118, Math.min(W - 118, px, above && Math.abs(ey - sy) < 60 ? endLeft - 124 : Infinity));

  return (
    <svg viewBox={`0 0 ${W} 340`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={ariaLabel}>
      {vLines.map((v) => (
        <line key={`v${v}`} x1={v} y1="0" x2={v} y2="340" stroke={C.grid} strokeWidth="1" />
      ))}
      {hLines.map((h) => (
        <line key={`h${h}`} x1="0" y1={h.toFixed(1)} x2={W} y2={h.toFixed(1)} stroke={C.grid} strokeWidth="1" />
      ))}
      {labels.map((p) => (
        <text key={p} x="10" y={(20 + (100 - p) * k + 6).toFixed(1)} style={{ fontFamily: F.cond }} fontSize="18" fill={C.muted}>
          {p}
        </text>
      ))}
      <line x1="0" y1={ty.toFixed(1)} x2={W} y2={ty.toFixed(1)} stroke={C.signal} strokeWidth="3" />
      <text x={W - 10} y={(ty + 23).toFixed(1)} textAnchor="end" style={{ fontFamily: F.sans }} fontSize="17" fontWeight="600" fill={C.signalInk}>
        {Math.round(threshold * 100)}%
      </text>
      <polyline
        fill="none"
        stroke={C.ink}
        strokeWidth="3"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={pts.map((s) => `${x(s.t).toFixed(1)},${y(s.p).toFixed(1)}`).join(" ")}
      />
      {px !== null && (
        <>
          <circle cx={px.toFixed(1)} cy={my.toFixed(1)} r="17" fill={C.panel} stroke={C.ink} strokeWidth="2" />
          <Paw x={px} y={my + 1} rotate={20} scale={1.25} />
          {/* Leader from the paw's ring to the stamp's near edge. */}
          <line x1={px.toFixed(1)} y1={(my + d * 19).toFixed(1)} x2={sx.toFixed(1)} y2={(sy - d * 28).toFixed(1)} stroke={C.ink} strokeWidth="1.5" />
          <g transform={`rotate(-5 ${sx.toFixed(1)} ${sy.toFixed(1)})`}>
            <rect x={(sx - 114).toFixed(1)} y={(sy - 24).toFixed(1)} width="228" height="50" fill={C.panel} stroke={C.signal} strokeWidth="3.5" />
            <Paw x={sx - 84} y={sy + 2} rotate={-15} scale={1.2} fill={C.signalInk} />
            <text x={(sx + 16).toFixed(1)} y={(sy + 11).toFixed(1)} textAnchor="middle" style={{ fontFamily: F.cond }} fontSize="30" fontWeight="700" fill={C.signalInk} letterSpacing="2.5">
              PAID EARLY
            </text>
          </g>
        </>
      )}
      <CatHeadShape x={ex - 4} y={ey - 20} scale={1.8} />
      <text x={(ex - 12).toFixed(1)} y={(ey - 22).toFixed(1)} textAnchor="end" style={{ fontFamily: F.sans }} fontSize="17" fontWeight="600" fill={C.ink}>
        {endLabel}
      </text>
    </svg>
  );
}
