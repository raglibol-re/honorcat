import { toUnits, validateParams, type TriggerParams, type TriggerSide } from "./params";

/**
 * The probability trigger. Pure and integer-only: the same samples and parameters always give the
 * same decision, on any machine. A raw tick never triggers: only a time-weighted average of valid
 * samples over a full window, with enough valid samples and fresh data at the end.
 */

/** Why a sample does or does not count. The numeric codes are part of the evidence format. */
export const SAMPLE_STATUS = {
  ok: 0,
  missing_side: 1, // no bid or no ask (one-sided or empty book)
  crossed: 2, // bid >= ask
  spread: 3, // ask - bid above maxSpreadUnits
  bid_size: 4, // best bid size below minSizeUnits
  ask_size: 5, // best ask size below minSizeUnits
  stale: 6, // exchange event time older than maxStalenessMs at sampling time
  off_tick: 7, // a price or size not representable in the market's units
} as const;
export type SampleStatus = (typeof SAMPLE_STATUS)[keyof typeof SAMPLE_STATUS];
export const STATUS_NAME = Object.fromEntries(Object.entries(SAMPLE_STATUS).map(([k, v]) => [v, k])) as Record<SampleStatus, string>;

/** A raw best-bid/ask observation as received (Gemini bookTicker: b, B, a, A, E). */
export type RawQuote = {
  t: number; // sampling instant, ms
  dataT: number; // exchange event time, ms
  bid: string | null;
  bidSize: string | null;
  ask: string | null;
  askSize: string | null;
};

/** A classified sample, integers only. Prices/sizes are 0 when absent. */
export type Sample = {
  t: number;
  dataT: number;
  bid: bigint;
  ask: bigint;
  bidSize: bigint;
  askSize: bigint;
  status: SampleStatus;
};

export function classify(q: RawQuote, p: TriggerParams): Sample {
  const conv = (v: string | null, d: number) => (v === null || v === "" ? 0n : toUnits(v, d));
  const bid = conv(q.bid, p.priceDecimals);
  const ask = conv(q.ask, p.priceDecimals);
  const bidSize = conv(q.bidSize, p.sizeDecimals);
  const askSize = conv(q.askSize, p.sizeDecimals);
  const base = { t: q.t, dataT: q.dataT };
  if (bid === null || ask === null || bidSize === null || askSize === null) {
    return { ...base, bid: bid ?? 0n, ask: ask ?? 0n, bidSize: bidSize ?? 0n, askSize: askSize ?? 0n, status: SAMPLE_STATUS.off_tick };
  }
  return { ...base, bid, ask, bidSize, askSize, status: statusOf({ ...base, bid, ask, bidSize, askSize }, p) };
}

/** Recomputes a sample's status from its integer fields (used to audit evidence). */
export function statusOf(s: Omit<Sample, "status">, p: TriggerParams): SampleStatus {
  if (s.bid <= 0n || s.ask <= 0n || s.bidSize <= 0n || s.askSize <= 0n) return SAMPLE_STATUS.missing_side;
  if (s.t - s.dataT > p.maxStalenessMs) return SAMPLE_STATUS.stale;
  if (s.bid >= s.ask) return SAMPLE_STATUS.crossed;
  if (s.ask - s.bid > BigInt(p.maxSpreadUnits)) return SAMPLE_STATUS.spread;
  if (s.bidSize < BigInt(p.minSizeUnits)) return SAMPLE_STATUS.bid_size;
  if (s.askSize < BigInt(p.minSizeUnits)) return SAMPLE_STATUS.ask_size;
  return SAMPLE_STATUS.ok;
}

export const DECISION = {
  triggered: 0,
  below_threshold: 1,
  insufficient_samples: 2,
  stale_at_end: 3, // the newest sample is invalid or older than maxStalenessMs at window end
  no_data: 4,
} as const;
export type DecisionCode = (typeof DECISION)[keyof typeof DECISION];
export const DECISION_NAME = Object.fromEntries(Object.entries(DECISION).map(([k, v]) => [v, k])) as Record<DecisionCode, string>;

export type Decision = {
  triggered: boolean;
  code: DecisionCode;
  windowStart: number;
  windowEnd: number;
  validCount: number;
  /** Time-weighted average probability in micro price units (price units x 10^6), floored. */
  averageMicro: bigint;
  /** The threshold in the same unit, for comparison. */
  thresholdMicro: bigint;
  /** Milliseconds of the window covered by valid samples. */
  coveredMs: number;
};

const MICRO = 1_000_000n;

export function thresholdMicro(p: TriggerParams): bigint {
  return (BigInt(p.thresholdBps) * 10n ** BigInt(p.priceDecimals) * MICRO) / 10_000n;
}

/** Doubled midpoint in price units, for the chosen side (avoids halving before averaging). */
function mid2(s: Sample, side: TriggerSide, p: TriggerParams): bigint {
  const m2 = s.bid + s.ask;
  return side === "yes" ? m2 : 2n * 10n ** BigInt(p.priceDecimals) - m2;
}

/**
 * Decides over the window (windowEnd - windowMs, windowEnd]. Samples must be in strictly
 * increasing time order. Each valid sample holds its midpoint until the next sample (valid or
 * not), the window end, or maxStalenessMs, whichever comes first; invalid samples and gaps carry
 * no weight. Triggers only if: at least minValidSamples valid samples, the newest sample is
 * valid and within maxStalenessMs of the window end, and the time-weighted average of the valid
 * midpoints is at or above the threshold.
 */
export function evaluate(samples: Sample[], p: TriggerParams, side: TriggerSide, windowEnd: number): Decision {
  validateParams(p);
  const windowStart = windowEnd - p.windowMs;
  const inWindow = samples.filter((s) => s.t > windowStart && s.t <= windowEnd);
  for (let i = 1; i < inWindow.length; i++) {
    if (inWindow[i]!.t <= inWindow[i - 1]!.t) throw new Error("samples must be in strictly increasing time order");
  }
  const thr = thresholdMicro(p);
  const base = { windowStart, windowEnd, thresholdMicro: thr };
  if (inWindow.length === 0) return { ...base, triggered: false, code: DECISION.no_data, validCount: 0, averageMicro: 0n, coveredMs: 0 };

  let weighted = 0n;
  let covered = 0;
  let validCount = 0;
  inWindow.forEach((s, i) => {
    if (s.status !== SAMPLE_STATUS.ok) return;
    validCount++;
    const until = Math.min(i + 1 < inWindow.length ? inWindow[i + 1]!.t : windowEnd, windowEnd, s.t + p.maxStalenessMs);
    const w = until - s.t;
    if (w <= 0) return;
    covered += w;
    weighted += mid2(s, side, p) * BigInt(w);
  });
  // average = weighted / (2 * covered), in micro units
  const averageMicro = covered > 0 ? (weighted * MICRO) / (2n * BigInt(covered)) : 0n;
  const last = inWindow[inWindow.length - 1]!;
  const r = { ...base, validCount, averageMicro, coveredMs: covered };

  if (validCount < p.minValidSamples) return { ...r, triggered: false, code: DECISION.insufficient_samples };
  if (last.status !== SAMPLE_STATUS.ok || windowEnd - last.t > p.maxStalenessMs) return { ...r, triggered: false, code: DECISION.stale_at_end };
  if (averageMicro < thr) return { ...r, triggered: false, code: DECISION.below_threshold };
  return { ...r, triggered: true, code: DECISION.triggered };
}

/**
 * Turns a stream of raw best-bid/ask updates into periodic samples, as a sampler does: at every
 * interval tick it takes the newest update received at or before that instant. Deterministic, so a
 * recorded feed replays exactly.
 */
export function sampleFeed(
  updates: { recv: number; dataT: number; bid: string | null; bidSize: string | null; ask: string | null; askSize: string | null }[],
  p: TriggerParams,
  from: number,
  to: number,
): Sample[] {
  const sorted = [...updates].sort((a, b) => a.recv - b.recv);
  const out: Sample[] = [];
  let j = -1;
  for (let t = from; t <= to; t += p.intervalMs) {
    while (j + 1 < sorted.length && sorted[j + 1]!.recv <= t) j++;
    if (j < 0) continue; // nothing received yet: no sample
    const u = sorted[j]!;
    out.push(classify({ t, dataT: u.dataT, bid: u.bid, bidSize: u.bidSize, ask: u.ask, askSize: u.askSize }, p));
  }
  return out;
}

/** Parses one Gemini bookTicker message (E is in nanoseconds). */
export function fromBookTicker(m: { recv: number; E: number | string; b?: string; B?: string; a?: string; A?: string }) {
  return {
    recv: m.recv,
    dataT: Number(BigInt(String(m.E)) / 1_000_000n),
    bid: m.b ?? null,
    bidSize: m.B ?? null,
    ask: m.a ?? null,
    askSize: m.A ?? null,
  };
}

/**
 * Parses one Gemini `{symbol}@depth5` snapshot. Gemini sends a full top-5 snapshot every second
 * even when the book is unchanged, so the receive time is when the book was last confirmed
 * current; that is the sample's data time. (bookTicker only sends on change: a quiet but valid
 * book would look stale, so samplers use depth5.)
 */
export function fromDepth5(m: { recv: number; bids?: [string, string][]; asks?: [string, string][] }) {
  const b = m.bids?.[0];
  const a = m.asks?.[0];
  return { recv: m.recv, dataT: m.recv, bid: b?.[0] ?? null, bidSize: b?.[1] ?? null, ask: a?.[0] ?? null, askSize: a?.[1] ?? null };
}
