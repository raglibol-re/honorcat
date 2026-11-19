"use client";

import { useEffect, useState } from "react";
import { C } from "@/components/cat/tokens";
import { getJson } from "@/lib/api";

/** Honor's symbol: a small collar bell (paw prints stay the trail, cat heads stay lives). */
export function Bell({ size = 16, color = C.ink }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden style={{ flex: "none", display: "inline-block", verticalAlign: "-0.15em" }}>
      <rect x="3" y="2" width="14" height="3" rx="1.5" fill={color} />
      <circle cx="10" cy="12" r="6.5" fill={color} />
      <rect x="4.5" y="11" width="11" height="1.6" fill={C.page} />
      <circle cx="10" cy="15.2" r="1.3" fill={C.page} />
    </svg>
  );
}

export type HonorBrief = { points: number; title: string };

const cache = new Map<string, HonorBrief>();
let off = false;

/** Points and titles for accounts (null while Honor is switched off or loading). */
export function useHonor(accounts: (string | null | undefined)[]) {
  const list = [...new Set(accounts.filter((a): a is string => !!a).map((a) => a.toLowerCase()))].sort();
  const key = list.join(",");
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!key || off) return;
    const missing = key.split(",").filter((a) => !cache.has(a));
    if (!missing.length) return;
    let alive = true;
    getJson<{ honor: Record<string, HonorBrief> }>(`/api/hc/honor?accounts=${missing.join(",")}`)
      .then((r) => {
        Object.entries(r.honor).forEach(([a, h]) => cache.set(a, h));
        if (alive) setTick((t) => t + 1);
      })
      .catch((e) => {
        if (/404|off/.test(String(e))) off = true;
      });
    return () => {
      alive = false;
    };
  }, [key]);
  if (off) return null;
  return Object.fromEntries(list.filter((a) => cache.has(a)).map((a) => [a, cache.get(a)!])) as Record<string, HonorBrief>;
}

const fmt = (p: number) => (Math.round(p * 10) / 10).toLocaleString("en", { maximumFractionDigits: 1 });

/** "House Cat · 24 honor" with the bell; nothing while Honor is off. */
export function HonorBadge({ account, size = 15 }: { account: string | null | undefined; size?: number }) {
  const h = useHonor([account]);
  const x = account && h ? h[account.toLowerCase()] : undefined;
  if (!x) return null;
  return (
    <span title="Honor rewards conduct, never results; it has no cash value" style={{ display: "inline-flex", gap: 5, alignItems: "center", fontSize: size, color: C.body, whiteSpace: "nowrap" }}>
      <Bell size={size} />
      <span>
        {x.title} · {fmt(x.points)} honor
      </span>
    </span>
  );
}

export { fmt as fmtHonor };

/** "Honor: Mochi, House Cat · 24 · Pumpkin, Stray · 3" for the players of a pot or perp. */
export function PlayersHonor({ players }: { players: { account: string | null | undefined; name: string }[] }) {
  const h = useHonor(players.map((p) => p.account));
  const shown = players.filter((p) => p.account && h?.[p.account.toLowerCase()]);
  if (!h || !shown.length) return null;
  return (
    <p style={{ margin: 0, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", fontSize: 15, color: C.body }}>
      <Bell size={15} />
      {shown.map((p, i) => {
        const x = h[p.account!.toLowerCase()]!;
        return (
          <span key={p.account!}>
            {i > 0 && " · "}
            {p.name}: {x.title}, {fmt(x.points)} honor
          </span>
        );
      })}
    </p>
  );
}
