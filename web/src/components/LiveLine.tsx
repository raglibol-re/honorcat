"use client";

import { usePolling } from "@/lib/api";

type Live = {
  block: { number: string; timestamp: number } | null;
  lastConfirmation: { tx: string; latencyMs: number; at: string } | null;
};

/** Quiet status line: the current Arc block and the latency of the relay's last confirmation. */
export function LiveLine() {
  const { data } = usePolling<Live>("/api/chain/live", 3000);
  return (
    <p className="t-13 flex items-center gap-2" style={{ color: "var(--vg-muted)" }} aria-live="off">
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: data?.block ? "var(--vg-accent)" : "var(--vg-rule)" }}
      />
      <span>
        Arc block <span className="mono">{data?.block ? Number(data.block.number).toLocaleString("en-US") : "…"}</span>
      </span>
      {data?.lastConfirmation && (
        <span className="hidden sm:inline">
          , last confirmation <span className="mono">{(data.lastConfirmation.latencyMs / 1000).toFixed(1)} s</span>
        </span>
      )}
    </p>
  );
}
