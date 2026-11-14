import { formatUnits, parseUnits } from "viem";

export function formatUsdc(base: string | bigint): string {
  const n = Number(formatUnits(BigInt(base), 6));
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

export function parseUsdc(input: string): bigint {
  return parseUnits(input.trim() || "0", 6);
}

export const short = (a: string, n = 4) => (a.length > 2 + n * 2 ? `${a.slice(0, 2 + n)}…${a.slice(-n)}` : a);

export function formatTime(unix: number | null): string {
  if (!unix) return "—";
  return new Date(unix * 1000).toLocaleString("en-GB", {
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
