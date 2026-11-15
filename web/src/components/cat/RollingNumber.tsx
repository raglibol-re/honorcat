"use client";

/**
 * An integer whose digits roll like an odometer to the new value. Each digit is a column of 0-9
 * inside a window one cell high; changing the value slides the columns. Columns are keyed from
 * the right, so 97 -> 100 rolls the units and tens and grows a hundreds column.
 * Motion is off under prefers-reduced-motion (globals.css: .hc-roll).
 */
export function RollingNumber({ value, cell = "0.8em" }: { value: number | null; cell?: string }) {
  if (value === null) return <span>–</span>;
  const digits = String(Math.max(0, Math.round(value))).split("");
  return (
    <span aria-label={String(Math.round(value))} style={{ display: "inline-flex" }}>
      {digits.map((d, i) => {
        const fromRight = digits.length - 1 - i;
        return (
          <span key={fromRight} aria-hidden="true" style={{ display: "inline-block", height: cell, overflow: "hidden", lineHeight: cell }}>
            <span className="hc-roll" style={{ display: "flex", flexDirection: "column", transform: `translateY(calc(${-Number(d)} * ${cell}))` }}>
              {"0123456789".split("").map((n) => (
                <span key={n} style={{ height: cell, lineHeight: cell }}>
                  {n}
                </span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
