"use client";

import { useId, useState } from "react";
import { addressUrl } from "@/lib/chain";
import { formatUsdc } from "@/lib/format";

/**
 * "Locked on Arc": the pot balance read from the chain. Opening it reveals where to check it
 * yourself (contract, pot id, explorer).
 */
export function LockedBadge({ lockedUsdc, potId, vault }: { lockedUsdc: string; potId: number; vault: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="t-13">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
        style={{ borderColor: "var(--vg-rule)", background: "var(--vg-accent-soft)" }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden fill="none">
          <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" stroke="var(--vg-accent)" strokeWidth="1.3" />
          <path d="M4 5.5V4a2 2 0 1 1 4 0v1.5" stroke="var(--vg-accent)" strokeWidth="1.3" />
        </svg>
        <span style={{ color: "var(--vg-accent)" }} className="font-medium">
          Locked on Arc
        </span>
        <span className="mono">{formatUsdc(lockedUsdc)} USDC</span>
      </button>
      {open && (
        <dl id={id} className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt style={{ color: "var(--vg-muted)" }}>Read from</dt>
          <dd>the vault contract, live</dd>
          <dt style={{ color: "var(--vg-muted)" }}>Contract</dt>
          <dd>
            <a className="mono underline-offset-2 hover:underline" href={addressUrl(vault)} target="_blank" rel="noreferrer">
              {vault.slice(0, 10)}…{vault.slice(-6)}
            </a>
          </dd>
          <dt style={{ color: "var(--vg-muted)" }}>Pot</dt>
          <dd className="mono">#{potId}</dd>
        </dl>
      )}
    </div>
  );
}
