import { encodeAbiParameters, keccak256, type Hex } from "viem";

/**
 * Early-payout trigger parameters. Integers only: prices and sizes are expressed in the market's
 * smallest unit (10^-priceDecimals USD, 10^-sizeDecimals contracts), times in milliseconds,
 * the threshold in basis points of a $1 contract. All of them are fixed at pot creation through
 * the conditionId (see conditionIdForTrigger), so they cannot change afterwards.
 */
export type TriggerParams = {
  thresholdBps: number; // 8500 = 85%
  windowMs: number;
  intervalMs: number;
  minValidSamples: number;
  maxSpreadUnits: number; // in price units
  minSizeUnits: number; // per side, in size units
  maxStalenessMs: number;
  priceDecimals: number; // Gemini priceIncrement 0.01 -> 2
  sizeDecimals: number; // Gemini quantityIncrement 0.01 -> 2
};

/** Which probability the threshold applies to: the contract's YES side or its complement. */
export type TriggerSide = "yes" | "no";
/** early-only: pay on crossing, else refund at trading close. early-or-outcome: else pay at settlement if the event occurred. */
export type PotMode = "early-only" | "early-or-outcome";

export type TriggerCondition = {
  instrument: string; // Gemini instrumentSymbol, e.g. GEMI-WXHIGH-ATL-2611160459-56TO57
  side: TriggerSide;
  mode: PotMode;
  params: TriggerParams;
};

export const ENGINE_VERSION = "honorcat-trigger/1";

/**
 * PROVISIONAL defaults (decided 2026-11-15, to be tuned against real order books).
 * Spread and size are in USD and contracts here; paramsFor() converts them to market units.
 */
export const PROVISIONAL_DEFAULTS = {
  standard: { thresholdBps: 8500, windowMs: 30 * 60_000, intervalMs: 10_000, minValidSamples: 150, maxSpreadUsd: "0.05", minSizeContracts: "50", maxStalenessMs: 60_000 },
  demo: { thresholdBps: 8500, windowMs: 60_000, intervalMs: 2_000, minValidSamples: 25, maxSpreadUsd: "0.04", minSizeContracts: "10", maxStalenessMs: 10_000 },
} as const;

/** Which rule a market gets: under two hours to close the demo rule, otherwise the standard rule. */
export const PROFILE_CUTOFF_MS = 2 * 3600_000;
/** A pot needs time to be joined and one full window before trading closes. */
export const MIN_LEAD_MS = 4 * 60_000;

/** Exact decimal string -> integer units; null if the value has more precision than `decimals`. */
export function toUnits(value: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const frac = m[2] ?? "";
  const extra = frac.slice(decimals);
  if (/[1-9]/.test(extra)) return null; // off the market's increment
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((frac.slice(0, decimals) + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Builds parameters for a market from a template's provisional defaults and the market's increments. */
export function paramsFor(
  template: keyof typeof PROVISIONAL_DEFAULTS,
  market: { priceDecimals?: number; sizeDecimals?: number } = {},
  overrides: Partial<TriggerParams> = {},
): TriggerParams {
  const d = PROVISIONAL_DEFAULTS[template];
  const priceDecimals = market.priceDecimals ?? 2;
  const sizeDecimals = market.sizeDecimals ?? 2;
  const p: TriggerParams = {
    thresholdBps: d.thresholdBps,
    windowMs: d.windowMs,
    intervalMs: d.intervalMs,
    minValidSamples: d.minValidSamples,
    maxSpreadUnits: Number(toUnits(d.maxSpreadUsd, priceDecimals)),
    minSizeUnits: Number(toUnits(d.minSizeContracts, sizeDecimals)),
    maxStalenessMs: d.maxStalenessMs,
    priceDecimals,
    sizeDecimals,
    ...overrides,
  };
  validateParams(p);
  return p;
}

export function validateParams(p: TriggerParams) {
  const ints = Object.entries(p);
  for (const [k, v] of ints) if (!Number.isSafeInteger(v) || v < 0) throw new Error(`trigger parameter ${k} must be a non-negative integer`);
  if (p.thresholdBps < 1 || p.thresholdBps > 9999) throw new Error("threshold must be between 0.01% and 99.99%");
  if (p.intervalMs < 1 || p.windowMs < p.intervalMs) throw new Error("window must be at least one sample interval");
  if (p.minValidSamples < 1 || p.minValidSamples > Math.floor(p.windowMs / p.intervalMs) + 1) throw new Error("minValidSamples cannot exceed the samples a window can hold");
  if (p.maxStalenessMs < 1) throw new Error("maxStalenessMs must be positive");
  if (p.priceDecimals > 8 || p.sizeDecimals > 8) throw new Error("decimals out of range");
}

export const paramsAbi = {
  type: "tuple",
  components: [
    { name: "thresholdBps", type: "uint32" },
    { name: "windowMs", type: "uint64" },
    { name: "intervalMs", type: "uint64" },
    { name: "minValidSamples", type: "uint32" },
    { name: "maxSpreadUnits", type: "uint64" },
    { name: "minSizeUnits", type: "uint64" },
    { name: "maxStalenessMs", type: "uint64" },
    { name: "priceDecimals", type: "uint8" },
    { name: "sizeDecimals", type: "uint8" },
  ],
} as const;

export const paramsTuple = (p: TriggerParams) => ({
  thresholdBps: p.thresholdBps,
  windowMs: BigInt(p.windowMs),
  intervalMs: BigInt(p.intervalMs),
  minValidSamples: p.minValidSamples,
  maxSpreadUnits: BigInt(p.maxSpreadUnits),
  minSizeUnits: BigInt(p.minSizeUnits),
  maxStalenessMs: BigInt(p.maxStalenessMs),
  priceDecimals: p.priceDecimals,
  sizeDecimals: p.sizeDecimals,
});

export const sideCode = (s: TriggerSide) => (s === "yes" ? 0 : 1);
export const modeCode = (m: PotMode) => (m === "early-only" ? 0 : 1);

/**
 * The pot's conditionId commits to the market contract, the side, the pot mode and every trigger
 * parameter. The vault signs over this id, so the rule cannot be changed after creation.
 */
export function conditionIdForTrigger(c: TriggerCondition): Hex {
  validateParams(c.params);
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "uint8" }, { type: "uint8" }, paramsAbi],
      [ENGINE_VERSION, c.instrument, sideCode(c.side), modeCode(c.mode), paramsTuple(c.params)],
    ),
  );
}
