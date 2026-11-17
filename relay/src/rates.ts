/**
 * The USDC to EURC rate for showing amounts in euros, from Circle's Stablecoin Kits rates service
 * (`api.circle.com/v1/stablecoinKits/rates`, the endpoint Swap Kit's `getTokenRates` calls): cached
 * USD prices of both tokens on Arc testnet, no key and no wallet, divided into one rate. Called
 * directly so the server bundle stays small. Display only: pots still hold and pay USDC. Cached for
 * 10 minutes; on an error the last rate is returned.
 */
import { ARC_USDC } from "./arc";

export const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const TTL_MS = 10 * 60_000;
const RATES_URL = "https://api.circle.com/v1/stablecoinKits/rates";

export type EurRate = {
  /** EURC per 1 USDC. */
  eurcPerUsdc: number;
  usdcUsd: number;
  eurcUsd: number;
  /** When Circle priced the tokens (ms). */
  fetchedAt: number;
  source: string;
};

let cached: { rate: EurRate; at: number } | null = null;

export async function eurRate(): Promise<EurRate | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.rate;
  try {
    const url = `${RATES_URL}?chain=Arc_Testnet&addresses=${ARC_USDC.toLowerCase()},${ARC_EURC.toLowerCase()}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`rates service answered ${r.status}`);
    const res = (await r.json()) as { rates?: Record<string, Record<string, { priceUSD: string; fetchedAt: number }>> };
    const byAddr = res.rates?.["Arc_Testnet"] ?? {};
    const find = (a: string) => Object.entries(byAddr).find(([k]) => k.toLowerCase() === a.toLowerCase())?.[1];
    const u = find(ARC_USDC);
    const e = find(ARC_EURC);
    const usdcUsd = Number(u?.priceUSD);
    const eurcUsd = Number(e?.priceUSD);
    if (!(usdcUsd > 0) || !(eurcUsd > 0)) throw new Error("no USDC or EURC price for Arc testnet");
    const rate: EurRate = {
      eurcPerUsdc: usdcUsd / eurcUsd,
      usdcUsd,
      eurcUsd,
      fetchedAt: Math.min(u!.fetchedAt, e!.fetchedAt),
      source: "Circle Stablecoin Kits rates (Swap Kit getTokenRates), Arc testnet",
    };
    cached = { rate, at: Date.now() };
    return rate;
  } catch (err) {
    console.error("[rates]", (err as Error).message);
    return cached?.rate ?? null;
  }
}
