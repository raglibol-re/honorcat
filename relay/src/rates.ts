/**
 * The USDC to EURC rate for showing amounts in euros: Circle Swap Kit's `getTokenRates` on Arc testnet
 * (cached USD prices of both tokens; no key, no wallet), divided into one rate. Display only: pots
 * still hold and pay USDC. Cached for 10 minutes; on an error the last rate is returned with its age.
 */
import { ARC_USDC } from "./arc";

export const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
const TTL_MS = 10 * 60_000;

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
    const { SwapKit } = await import("@circle-fin/swap-kit");
    const res = await new SwapKit().getTokenRates({ chain: "Arc_Testnet", tokens: ["USDC", "EURC"] });
    const byAddr = (res.rates as Record<string, Record<string, { priceUSD: string; fetchedAt: number }>>)["Arc_Testnet"] ?? {};
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
      source: "Circle Swap Kit getTokenRates, Arc testnet",
    };
    cached = { rate, at: Date.now() };
    return rate;
  } catch (err) {
    console.error("[rates]", (err as Error).message);
    return cached?.rate ?? null;
  }
}
