"use client";

import type { Pot } from "@/lib/api";
import { addressUrl, txUrl } from "@/lib/chain";
import { short } from "@/lib/format";

export function StatusBadge({ pot }: { pot: Pick<Pot, "status" | "outcome"> }) {
  const map = {
    open: { text: "Open", color: "#111111" },
    resolved_true: { text: "Paid out", color: "#B8320F" },
    resolved_false: { text: "Refunded", color: "#55534E" },
    expired: { text: "Expired, refunded", color: "#55534E" },
  } as const;
  const key = pot.status === "resolved" ? (pot.outcome ? "resolved_true" : "resolved_false") : pot.status;
  const { text, color } = map[key];
  return <span className="inline-flex text-sm font-semibold" style={{ color }}>{text}</span>;
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

/** A section under an ink rule (no boxed cards: docs/design). */
export function Card({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="border-t-[1.5px] border-foreground">
      {title && (
        <div className="flex items-center justify-between gap-4 pt-3 pb-2">
          <h2 className="text-2xl leading-none">{title}</h2>
          {right}
        </div>
      )}
      <div className={title ? "pb-2" : "py-4"}>{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[17px] font-semibold">{label}</span>
      {children}
      {hint && <span className="block text-sm text-muted">{hint}</span>}
    </label>
  );
}

export const inputCls = "hc-input";

export const buttonCls = "hc-btn";

export const secondaryButtonCls = "hc-btn hc-btn--quiet";
