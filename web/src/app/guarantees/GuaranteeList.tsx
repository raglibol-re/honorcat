"use client";

import Link from "next/link";
import { usePolling } from "@/lib/api";
import { formatUsdc } from "@/lib/format";

type Row = {
  id: string;
  template: string;
  merchantName: string;
  promise: string;
  refund: string;
  maxCustomers: number;
  enrolled: number;
  settlesAt: number;
  potStatus: string | null;
  outcome: boolean | null;
  lockedTotal: string | null;
  status: string;
};

const statusText = (r: Row) =>
  r.potStatus === "resolved" ? (r.outcome ? "Refunds paid" : "Not triggered") : r.potStatus === "expired" ? "Expired, returned" : r.status === "live" ? "Open" : "Pending";

export function GuaranteeList() {
  const { data, error } = usePolling<{ guarantees: Row[] }>("/api/guarantees", 5000);
  if (error && !data) return <p className="t-15">{error}</p>;
  if (!data) return <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;
  if (data.guarantees.length === 0)
    return (
      <p className="t-15 rounded-xl border px-4 py-6 text-center" style={{ borderColor: "var(--vg-rule)" }}>
        No guarantees yet.{" "}
        <Link href="/guarantees/new" className="underline underline-offset-4">
          Offer the first one
        </Link>
        .
      </p>
    );
  return (
    <ul className="space-y-3">
      {data.guarantees.map((r) => (
        <li key={r.id}>
          <Link href={`/g/${r.id}`} className="vg-ticket block px-5 py-4 hover:border-[var(--vg-accent)]">
            <div className="t-13 flex flex-wrap justify-between gap-2" style={{ color: "var(--vg-muted)" }}>
              <span>
                {r.merchantName}
                {r.template === "demo" ? " · demo" : ""}
              </span>
              <span style={r.potStatus === "resolved" && r.outcome ? { color: "var(--vg-accent)" } : undefined}>{statusText(r)}</span>
            </div>
            <p className="t-17 mt-1 font-medium">{r.promise}</p>
            <dl className="t-13 mt-3 grid grid-cols-3 gap-3">
              <div>
                <dt style={{ color: "var(--vg-muted)" }}>Enrolled</dt>
                <dd className="mono">
                  {r.enrolled} / {r.maxCustomers}
                </dd>
              </div>
              <div>
                <dt style={{ color: "var(--vg-muted)" }}>Cost if triggered</dt>
                <dd className="mono">{formatUsdc((BigInt(r.refund) * BigInt(r.enrolled)).toString())} USDC</dd>
              </div>
              <div>
                <dt style={{ color: "var(--vg-muted)" }}>Locked on Arc</dt>
                <dd className="mono">{r.lockedTotal ? formatUsdc(r.lockedTotal) : "—"} USDC</dd>
              </div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
