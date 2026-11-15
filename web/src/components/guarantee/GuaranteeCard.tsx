"use client";

import { formatMoney } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { HonorCatMark } from "@/components/brand/HonorCatMark";
import { LockedBadge } from "./LockedBadge";
import { SettlementRail, type RailStep } from "./SettlementRail";

export type GuaranteeCardData = {
  merchant: string;
  /** The promise in one plain sentence, rendered from the market's fields. */
  promise: string;
  refundUsdc: string; // base units, from the chain
  /** Gemini YES price as an estimate of the chance of a refund (0..1), or null if no live price. */
  chance: number | null;
  settlesAt: string; // ISO, market expiry
  state: "active" | "refunded" | "not_triggered";
  seat: { n: number; of: number };
  account: string;
  lockedUsdc: string; // base units, from the chain
  potId: number;
  vault: string;
  steps: RailStep[];
  /** Plain reason, taken from the payout memo once settled. */
  reason?: string;
};

function countdown(ms: number) {
  if (ms <= 0) return "now";
  const m = Math.floor(ms / 60_000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mm}m`;
  const s = Math.floor((ms % 60_000) / 1000);
  return `${mm}m ${s.toString().padStart(2, "0")}s`;
}

/**
 * The customer's guarantee: a ticket readable at arm's length. Above the perforation is the
 * promise; below it, the proof that the money exists and where the settlement stands.
 */
export function GuaranteeCard({
  g,
  canWithdraw = false,
  onWithdraw,
  brand = true,
}: {
  g: GuaranteeCardData;
  canWithdraw?: boolean;
  onWithdraw?: () => void;
  /** HonorCat branding (mark in the header, "HonorCat, settled by Verdict" at the foot). */
  brand?: boolean;
}) {
  const now = useNow();
  const settleMs = new Date(g.settlesAt).getTime();
  const settled = g.state !== "active";

  return (
    <article className="vg-ticket w-full max-w-[420px] overflow-hidden" aria-label="Your guarantee">
      {/* ---------------------------------------------------------------- promise */}
      <div className="px-6 pb-6 pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <span className="t-15 font-medium">{g.merchant}</span>
          {brand ? (
            <span className="t-13 inline-flex items-center gap-1.5 font-medium" style={{ color: "var(--vg-accent)" }}>
              <HonorCatMark size={15} />
              HonorCat
            </span>
          ) : (
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Guarantee
            </span>
          )}
        </div>

        <p className="t-21 mt-5 font-medium" style={{ textWrap: "pretty" }}>
          {g.promise}
        </p>

        {!settled ? (
          <dl className="mt-6 grid grid-cols-2 gap-y-4">
            <div className="col-span-2">
              <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
                Your refund
              </dt>
              <dd className="mono t-36 mt-1 font-medium">{formatMoney(g.refundUsdc)}</dd>
              <dd className="t-13" style={{ color: "var(--vg-muted)" }}>
                in USDC, already set aside for you
              </dd>
            </div>
            <div>
              <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
                Chance of a refund
              </dt>
              <dd className="mono t-21 mt-0.5">{g.chance === null ? "—" : `${Math.round(g.chance * 100)}%`}</dd>
              <dd className="t-13" style={{ color: "var(--vg-muted)" }}>
                {g.chance === null ? "no live market price" : "estimate from the market price"}
              </dd>
            </div>
            <div>
              <dt className="t-13" style={{ color: "var(--vg-muted)" }}>
                Settles in
              </dt>
              <dd className="mono t-21 mt-0.5" suppressHydrationWarning>
                {now ? countdown(settleMs - now) : "—"}
              </dd>
              <dd className="t-13" style={{ color: "var(--vg-muted)" }} suppressHydrationWarning>
                {now ? new Date(settleMs).toLocaleString("en-US", { weekday: "short", hour: "2-digit", minute: "2-digit" }) : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-6">
            <p className="t-13" style={{ color: "var(--vg-muted)" }}>
              {g.state === "refunded" ? "Refunded" : "Not triggered"}
            </p>
            <p className="mono t-36 mt-1 font-medium" style={{ color: g.state === "refunded" ? "var(--vg-accent)" : "var(--vg-muted)" }}>
              {g.state === "refunded" ? formatMoney(g.refundUsdc) : "$0.00"}
              <span className="t-15 ml-2 font-normal">in USDC</span>
            </p>
            {g.reason && (
              <p className="t-15 mt-3" style={{ color: "var(--vg-ink)" }}>
                {g.reason}
              </p>
            )}
            {g.state === "refunded" && canWithdraw && (
              <button
                type="button"
                onClick={onWithdraw}
                className="t-15 mt-5 w-full px-4 py-3 font-medium"
                style={{ background: "#111111", color: "#ECEAE4" }}
              >
                Withdraw refund
              </button>
            )}
          </div>
        )}
      </div>

      {/* ---------------------------------------------------------------- perforation */}
      <div className="vg-perf" aria-hidden />

      {/* ---------------------------------------------------------------- proof */}
      <div className="space-y-5 px-6 pb-5 pt-5">
        <SettlementRail steps={g.steps} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <LockedBadge lockedUsdc={g.lockedUsdc} potId={g.potId} vault={g.vault} released={settled} />
          <div className="t-13 text-right" style={{ color: "var(--vg-muted)" }}>
            {g.account ? (
              <>
                <div>
                  Seat {g.seat.n} of {g.seat.of}
                </div>
                <div className="mono">
                  {g.account.slice(0, 6)}…{g.account.slice(-4)}
                </div>
              </>
            ) : (
              <div>
                {g.seat.n} of {g.seat.of} places taken
              </div>
            )}
          </div>
        </div>
        {brand && (
          <p className="t-13 border-t pt-3" style={{ borderColor: "var(--vg-rule)", color: "var(--vg-muted)" }}>
            HonorCat, settled by Verdict on Arc
          </p>
        )}
      </div>
    </article>
  );
}
