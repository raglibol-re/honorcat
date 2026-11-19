/**
 * How every amount is written (pure, no React): two decimals for whole cents, three when there is a
 * tenth of a cent or the amount is under one, "under 0.1¢" below a tenth of a cent. Amounts that are
 * whole tenths of a cent are written exactly, so parts written this way add up to the written whole
 * (splitPot rounds shares to tenths of a cent, and one side is always the pot minus the other).
 */
export function formatAmount(v: number, symbol = "$"): string {
  const a = Math.abs(v);
  if (a === 0) return `${symbol}0.00`;
  if (a < 0.001) return symbol === "$" ? "under 0.1¢" : `under ${symbol}0.001`;
  const mills = Math.round(a * 1000);
  const decimals = a < 1 || mills % 10 !== 0 ? 3 : 2;
  return `${v < 0 ? "-" : ""}${symbol}${a.toFixed(decimals)}`;
}

/** The written amount back as a number (for checks): "$7.405" -> 7.405, "under 0.1¢" -> 0. */
export function parseAmount(s: string): number {
  if (s.startsWith("under")) return 0;
  return Number(s.replace(/[^0-9.\-]/g, ""));
}
