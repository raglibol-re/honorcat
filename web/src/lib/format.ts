import { formatUnits, parseUnits } from "viem";
import { inEuros, money } from "@/lib/currency";

export function formatUsdc(base: string | bigint): string {
  const n = Number(formatUnits(BigInt(base), 6));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

/** "$0.25": consumer-facing amount. Amounts are USDC (6 decimals), a dollar stablecoin. */
export function formatMoney(base: string | bigint): string {
  return inEuros() ? money(base) : `$${formatUsdc(base)}`;
}

export function parseUsdc(input: string): bigint {
  return parseUnits(input.trim() || "0", 6);
}

export const short = (a: string, n = 4) => (a.length > 2 + n * 2 ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);

/** The page language (<html lang="en">). Dates follow it, not the browser locale. */
export const PAGE_LOCALE = "en-US";

/** "Nov 15, 3:02 PM" (ms). */
export const formatDate = (ms: number) => new Date(ms).toLocaleString(PAGE_LOCALE, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** "3:02:15 PM" (ms). */
export const formatClock = (ms: number) => new Date(ms).toLocaleTimeString(PAGE_LOCALE, { hour: "numeric", minute: "2-digit", second: "2-digit" });
/** Axis label: "3:02 PM", or "Nov 15" when the span is several days (ms). */
export const formatAxis = (ms: number, spanMs: number) =>
  spanMs > 2 * 86_400_000
    ? new Date(ms).toLocaleDateString(PAGE_LOCALE, { month: "short", day: "numeric" })
    : new Date(ms).toLocaleTimeString(PAGE_LOCALE, spanMs < 600_000 ? { hour: "numeric", minute: "2-digit", second: "2-digit" } : { hour: "numeric", minute: "2-digit" });

export function formatTime(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString(PAGE_LOCALE, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const kindLabel: Record<string, string> = {
  payout: "Payout",
  refund: "Refund",
  payout_deferred: "Payout (claimable)",
  refund_deferred: "Refund (claimable)",
  claim: "Claim",
  guarantee_refund: "Refund to customer",
  guarantee_deferred: "Refund (claimable)",
  guarantee_leftover: "Unused places returned",
  guarantee_claim: "Claimed refund",
};
