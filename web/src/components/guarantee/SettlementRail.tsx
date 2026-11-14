"use client";

import { txUrl } from "@/lib/chain";

export type RailStep = {
  key: "locked" | "enrolled" | "event" | "verdict" | "paid";
  label: string;
  done: boolean;
  tx?: string;
  block?: number;
  time?: number; // unix seconds
};

export const RAIL_LABELS: Record<RailStep["key"], string> = {
  locked: "Locked",
  enrolled: "Enrolled",
  event: "Event",
  verdict: "Verdict",
  paid: "Paid",
};

const shortHash = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const clock = (t: number) => new Date(t * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Five-step rail from money locked to money paid. Completed steps show where it happened on Arc
 * (short tx hash, block, time). A step animates only at the moment it becomes done: the dot is
 * keyed by its done-state, so it re-mounts once.
 */
export function SettlementRail({ steps, compact = false }: { steps: RailStep[]; compact?: boolean }) {
  const lastDone = steps.reduce((i, s, j) => (s.done ? j : i), -1);
  return (
    <ol className="grid grid-cols-5" aria-label="Settlement progress">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex flex-col items-start pr-1">
          {/* connector to the next step */}
          {i < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute left-[9px] right-0 top-[9px] h-px"
              style={{ background: i < lastDone ? "var(--vg-accent)" : "var(--vg-rule)" }}
            />
          )}
          <span
            key={`${s.key}-${s.done}`}
            aria-hidden
            className={`relative z-10 flex h-[19px] w-[19px] items-center justify-center rounded-full border ${s.done ? "vg-step-done" : ""}`}
            style={{
              borderColor: s.done ? "var(--vg-accent)" : "var(--vg-rule)",
              background: s.done ? "var(--vg-accent)" : "var(--vg-card)",
            }}
          >
            {s.done && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M2 5.2 4.1 7.3 8 3" stroke="var(--vg-card)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className="t-13 mt-2 font-medium" style={{ color: s.done ? "var(--vg-ink)" : "var(--vg-muted)" }}>
            {s.label}
            <span className="sr-only">{s.done ? " (done)" : " (pending)"}</span>
          </span>
          {!compact && s.done && s.tx && (
            <a
              key={`chip-${s.key}-${s.tx}`}
              href={txUrl(s.tx)}
              target="_blank"
              rel="noreferrer"
              className="vg-chip-in mono mt-1 block text-[11px] leading-4 hover:underline"
              style={{ color: "var(--vg-muted)" }}
              title={`Transaction ${s.tx}${s.block ? `, block ${s.block}` : ""}`}
            >
              {shortHash(s.tx)}
              {s.block !== undefined && <span className="block">#{s.block.toLocaleString("en-US")}</span>}
              {s.time !== undefined && <span className="block">{clock(s.time)}</span>}
            </a>
          )}
        </li>
      ))}
    </ol>
  );
}
