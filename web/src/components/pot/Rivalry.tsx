"use client";

import { C, F } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";

type Rivalry = { played: number; aAhead: number; bAhead: number; even: number };

/**
 * The running head-to-head record between two players (finished pots, practice excluded): who came
 * out ahead how often. `intro` frames it for a challenge ("You and Mochi"); without it, the two
 * names are listed with their counts.
 */
export function RivalryLine({
  a,
  b,
  nameA,
  nameB,
  intro,
}: {
  a: string | null | undefined;
  b: string | null | undefined;
  nameA: string;
  nameB: string;
  intro?: boolean;
}) {
  const ok = !!a && !!b && a.toLowerCase() !== b.toLowerCase();
  const { data } = usePolling<Rivalry>(ok ? `/api/hc/rivalry?a=${a}&b=${b}` : null, 120_000);
  if (!ok || !data) return null;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const text =
    data.played === 0
      ? intro
        ? `${cap(nameA)} and ${nameB} have not met in a pot yet.`
        : `First meeting of ${nameA} and ${nameB}.`
      : `${cap(nameA)} ${data.aAhead}, ${nameB} ${data.bAhead}${data.even ? `, ${data.even} even` : ""} (${data.played} ${data.played === 1 ? "pot" : "pots"}).`;
  return (
    <p style={{ margin: 0, display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap", fontSize: 16 }}>
      <span style={{ fontFamily: F.mono, fontSize: 12, letterSpacing: "0.06em", textTransform: "uppercase", color: C.muted }}>Head to head</span>
      <span>{text}</span>
    </p>
  );
}
