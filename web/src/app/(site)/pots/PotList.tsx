"use client";

import Link from "next/link";
import { usePolling, type Pot } from "@/lib/api";
import { formatTime, formatUsdc } from "@/lib/format";
import { StatusBadge } from "@/components/ui";

export function PotList() {
  const { data, error } = usePolling<{ pots: Pot[] }>("/api/pots?limit=100&scope=guarantees", 4000);

  if (error && !data) return <p className="text-sm text-negative">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading…</p>;
  if (data.pots.length === 0) return <p className="text-sm text-muted">No pots yet.</p>;

  return (
    <div className="overflow-x-auto border-y-[1.5px] border-foreground">
      <table className="w-full text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <tr>
            <th className="px-4 py-2 font-medium">Pot</th>
            <th className="px-4 py-2 font-medium">Condition</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Deadline</th>
          </tr>
        </thead>
        <tbody>
          {data.pots.map((p) => (
            <tr key={p.potId} className="border-b border-border last:border-0 hover:bg-background">
              <td className="px-4 py-2">
                <Link href={`/pots/${p.potId}`} className="font-mono text-accent hover:underline">
                  #{p.potId}
                </Link>
              </td>
              <td className="px-4 py-2">{p.condition?.label ?? <span className="font-mono text-muted">{p.conditionId.slice(0, 10)}…</span>}</td>
              <td className="px-4 py-2">
                <StatusBadge pot={p} />
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{formatUsdc(p.total)}</td>
              <td className="px-4 py-2 text-muted">{formatTime(p.deadline)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
