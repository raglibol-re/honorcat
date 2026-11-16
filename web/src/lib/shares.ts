/**
 * The two shares of a pot at a price, in USDC base units (6 decimals). One side is rounded to the
 * cent and the other is the pot minus that side, so the two always add up to the pot exactly.
 * Every page that shows shares uses this. Pure (the relay's tests check it).
 */
export function splitPot(notional: bigint, priceYes: number): { yes: bigint; no: bigint } {
  const p = Math.min(1, Math.max(0, priceYes));
  const rounded = BigInt(Math.round((Number(notional) * p) / 10_000)) * 10_000n; // whole cents
  const yes = rounded > notional ? notional : rounded;
  return { yes, no: notional - yes };
}

/** The share of `side` (0 = the first side, 1 = the other). */
export const shareOf = (notional: bigint, priceYes: number, side: number) => (side === 0 ? splitPot(notional, priceYes).yes : splitPot(notional, priceYes).no);
