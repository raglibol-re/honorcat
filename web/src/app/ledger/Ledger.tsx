"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePolling, type Payment } from "@/lib/api";
import { formatTime, formatUsdc, kindLabel } from "@/lib/format";
import { Addr, Tx } from "@/components/ui";

export function Ledger() {
  const { data, error } = usePolling<{ payments: Payment[] }>("/api/payments?limit=100", 2000);
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  // Highlight rows that arrive while the page is open.
  useEffect(() => {
    if (!data) return;
    const ids = data.payments.map((p) => p.id);
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const added = ids.filter((id) => !seen.current!.has(id));
    added.forEach((id) => seen.current!.add(id));
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 4000);
      return () => clearTimeout(t);
    }
  }, [data]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className={`h-2 w-2 rounded-full ${error ? "bg-negative" : "bg-positive animate-pulse"}`} />
        {error ? `Disconnected: ${error}` : "Live · updates every 2 seconds"}
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Time</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Pot</th>
              <th className="px-4 py-2 font-medium">Recipient</th>
              <th className="px-4 py-2 text-right font-medium">Amount (USDC)</th>
              <th className="px-4 py-2 font-medium">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {!data && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  Loading…
                </td>
              </tr>
            )}
            {data?.payments.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No payments yet.
                </td>
              </tr>
            )}
            {data?.payments.map((p) => (
              <tr
                key={p.id}
                className={`border-b border-border transition-colors duration-1000 last:border-0 ${fresh.has(p.id) ? "bg-green-50" : ""}`}
              >
                <td className="px-4 py-2 whitespace-nowrap text-muted">{formatTime(p.time)}</td>
                <td className="px-4 py-2">{kindLabel[p.kind]}</td>
                <td className="px-4 py-2">
                  {p.potId !== null ? (
                    <Link href={`/pots/${p.potId}`} className="font-mono text-accent hover:underline">
                      #{p.potId}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-2">
                  <Addr a={p.recipient} />
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${p.kind === "refund" ? "text-muted" : ""}`}>{formatUsdc(p.amount)}</td>
                <td className="px-4 py-2">
                  <Tx hash={p.txHash} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
