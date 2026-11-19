"use client";

import Link from "next/link";
import { C } from "@/components/cat/tokens";
import { usePolling } from "@/lib/api";
import { money } from "@/lib/currency";

type Open = { pots: { potId: string; notional: string; v2: boolean }[]; groups: { groupId: string; names: [string, string] }[] };

/**
 * Before opening a new pot on a market: someone may already wait for this side, or a group plays
 * it. Joining those is quicker than waiting for a stranger (and a copycat joins them the same way).
 */
export function OpenHere({ symbol, side, sideWord }: { symbol: string; side: number; sideWord: string }) {
  const { data } = usePolling<Open>(`/api/hc/open-on-market?symbol=${encodeURIComponent(symbol)}&side=${side}`, 30_000);
  if (!data || (!data.pots.length && !data.groups.length)) return null;
  return (
    <div role="note" style={{ border: `2px solid ${C.ink}`, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6, fontSize: 16 }}>
      {data.pots.length > 0 && (
        <span>
          Someone already waits for {sideWord} on this market:{" "}
          {data.pots.map((p, i) => (
            <span key={p.potId}>
              {i ? ", " : ""}
              <Link href={`/pots/${p.potId}`}>join pot {p.potId}</Link>
              {p.v2 ? "" : ` (${money(p.notional)})`}
            </span>
          ))}
          .
        </span>
      )}
      {data.groups.length > 0 && (
        <span>
          A group plays this market:{" "}
          {data.groups.map((g, i) => (
            <span key={g.groupId}>
              {i ? ", " : ""}
              <Link href={`/groups/${g.groupId}?team=${side}`}>join {g.names[side]}</Link>
            </span>
          ))}
          .
        </span>
      )}
    </div>
  );
}
