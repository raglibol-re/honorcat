"use client";

import type { Pot } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { short } from "@/lib/format";

export function StatusBadge({ pot }: { pot: Pick<Pot, "status" | "outcome"> }) {
  const map = {
    open: { text: "Open", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
    resolved_true: { text: "Paid out", cls: "bg-green-50 text-positive ring-green-200" },
    resolved_false: { text: "Refunded", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
    expired: { text: "Expired · refunded", cls: "bg-slate-100 text-slate-700 ring-slate-200" },
  } as const;
  const key = pot.status === "resolved" ? (pot.outcome ? "resolved_true" : "resolved_false") : pot.status;
  const { text, cls } = map[key];
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{text}</span>;
}

export function Addr({ a }: { a: string }) {
  return (
    <a href={addressUrl(a)} target="_blank" rel="noreferrer" className="font-mono text-sm hover:underline" title={a}>
      {short(a)}
    </a>
  );
}

export function Tx({ hash, label }: { hash: string; label?: string }) {
  return (
    <a href={txUrl(hash)} target="_blank" rel="noreferrer" className="font-mono text-sm text-accent hover:underline">
      {label ?? short(hash, 6)}
    </a>
  );
}

export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-surface">
      {title && (
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent focus:ring-1 focus:ring-accent";

export const buttonCls =
  "inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-surface disabled:opacity-50";

export const secondaryButtonCls =
  "inline-flex items-center justify-center rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium disabled:opacity-50";
