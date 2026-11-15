import { Bowl, Paw, SittingCat } from "./shapes";
import { C, F } from "./tokens";

const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * The 0–100 scale from the landing reference (viewBox 1440×260): one tick per point, the bowl at
 * the pot's threshold with the "pays" zone shaded, a trail of paw prints and the sitting cat at
 * the current chance. `chance` and `threshold` are 0..1; `chance` null hides the cat.
 */
export function CatScale({ chance, threshold, catLabel, compact }: { chance: number | null; threshold: number; catLabel?: string; compact?: boolean }) {
  if (compact) return <CatScaleCompact chance={chance} threshold={threshold} catLabel={catLabel} />;
  const x = (p: number) => 40 + 13.6 * p; // p in points, 0..100
  const bx = x(threshold * 100);
  const cx = chance === null ? null : x(Math.max(0, Math.min(1, chance)) * 100);
  const ticks = Array.from({ length: 101 }, (_, i) => i);

  // The bowl's label goes on the side away from the cat, if it fits (about 270 units wide).
  const bowlText = `the bowl: pays at ${pct(threshold)} or more`;
  const leftFits = bx + 26 - 270 >= 0;
  const rightFits = bx - 26 + 270 <= 1440;
  const labelLeft = cx === null || cx >= bx ? leftFits || !rightFits : !rightFits;

  // Paw trail: eight prints behind the cat, 3.5 points apart, alternating rows.
  const paws = cx === null ? [] : Array.from({ length: 8 }, (_, i) => ({ px: cx - 129.2 - (7 - i) * 47.6, py: i % 2 ? 166 : 150 })).filter((p) => p.px >= 60);
  const aria =
    `A scale from 0 to 100 percent. A food bowl stands at ${pct(threshold)}, where payouts fire.` +
    (cx === null ? "" : ` A black cat sits at ${pct(chance!)}${chance! >= threshold ? ", past the bowl" : ", before the bowl"}.`);

  return (
    <svg viewBox="0 0 1440 260" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={aria}>
      <rect x={bx.toFixed(1)} y="150" width={(1400 - bx).toFixed(1)} height="62" fill={C.signal} opacity="0.18" />
      <line x1="40" y1="212" x2="1400" y2="212" stroke={C.ink} strokeWidth="2" />
      {ticks.map((i) => {
        const tx = x(i).toFixed(1);
        const major = i % 10 === 0;
        const mid = !major && i % 5 === 0;
        return (
          <g key={i}>
            <line x1={tx} y1={major ? 178 : mid ? 188 : 198} x2={tx} y2="212" stroke={C.ink} strokeWidth={major ? 2 : mid ? 1.5 : 1} />
            {major && (
              <text x={tx} y="242" textAnchor="middle" style={{ fontFamily: F.cond }} fontSize="22" fontWeight="500" fill={C.ink}>
                {i}
              </text>
            )}
          </g>
        );
      })}
      {paws.map((p, i) => (
        <Paw key={i} x={p.px} y={p.py} rotate={90} scale={1.15} />
      ))}
      <Bowl x={bx} base={212} />
      <text x={(labelLeft ? bx + 26 : bx - 26).toFixed(1)} y="128" textAnchor={labelLeft ? "end" : "start"} style={{ fontFamily: F.sans }} fontSize="19" fontWeight="600" fill={C.signalInk}>
        {bowlText}
      </text>
      <line x1={bx.toFixed(1)} y1="136" x2={bx.toFixed(1)} y2="168" stroke={C.signalInk} strokeWidth="1.5" />
      {cx !== null && (
        <>
          <SittingCat x={Math.min(cx - 52, 1440 - 132)} y={72} />
          <text x={Math.min(cx + 70, 1436).toFixed(1)} y="58" textAnchor="end" style={{ fontFamily: F.sans }} fontSize="19" fontWeight="600" fill={C.ink}>
            {catLabel ?? `the cat: ${pct(chance!)} now`}
          </text>
        </>
      )}
    </svg>
  );
}

/** The recipient card's scale (viewBox 342×96): ticks every 5 points, small bowl, small cat. */
function CatScaleCompact({ chance, threshold, catLabel }: { chance: number | null; threshold: number; catLabel?: string }) {
  const x = (p: number) => 6 + 3.3 * p;
  const bx = x(threshold * 100);
  const cx = chance === null ? null : x(Math.max(0, Math.min(1, chance)) * 100);
  const ticks = Array.from({ length: 21 }, (_, i) => i * 5);
  const bowlText = `the bowl: pays at ${pct(threshold)}`;
  // Label on the side away from the cat when it fits (about 130 units).
  const left = cx === null || cx >= bx ? bx - 14 - 130 >= 0 || bx + 14 + 130 > 342 : bx + 14 + 130 > 342;
  const aria =
    `A scale from 0 to 100 percent. A food bowl stands at ${pct(threshold)}, where payouts fire.` +
    (cx === null ? "" : ` A black cat sits at ${pct(chance!)}.`);
  return (
    <svg viewBox="0 0 342 96" style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={aria}>
      <rect x={bx.toFixed(1)} y="44" width={(336 - bx).toFixed(1)} height="30" fill={C.signal} opacity="0.18" />
      <line x1="6" y1="74" x2="336" y2="74" stroke={C.ink} strokeWidth="1.5" />
      {ticks.map((i) => {
        const tx = x(i).toFixed(1);
        const end = i === 0 || i === 50 || i === 100;
        return (
          <g key={i}>
            <line x1={tx} y1={end ? 56 : i % 10 === 0 ? 62 : 67} x2={tx} y2="74" stroke={C.ink} strokeWidth={end ? 1.5 : 1} />
            {end && (
              <text x={tx} y="92" textAnchor={i === 0 ? "start" : i === 100 ? "end" : "middle"} style={{ fontFamily: F.cond }} fontSize="15" fill={C.muted}>
                {i}
              </text>
            )}
          </g>
        );
      })}
      <Bowl x={bx} base={74} size="small" />
      <text x={(left ? bx - 14 : bx + 14).toFixed(1)} y="52" textAnchor={left ? "end" : "start"} style={{ fontFamily: F.sans }} fontSize="13" fontWeight="600" fill={C.signalInk}>
        {bowlText}
      </text>
      {cx !== null && (
        <>
          <SittingCat x={Math.min(cx - 15, 342 - 45)} y={26.4} scale={0.34} />
          <text x="336" y="14" textAnchor="end" style={{ fontFamily: F.sans }} fontSize="13" fontWeight="600" fill={C.ink}>
            {catLabel ?? `the cat: ${pct(chance!)} now`}
          </text>
        </>
      )}
    </svg>
  );
}
