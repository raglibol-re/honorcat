/**
 * The arithmetic of perps (no browser code, so tests can import it): the rope a leverage step
 * gives, the rules HonorCatRopes checks for a symmetric rope, stakes and labels. See perp.ts.
 */
import { maxLeverage, minDistance, P, TICK } from "./rope";

export const POST_MARGIN = 20_000; // a post stays at least 2 points inside 0 and 100
export const FIRST_TOLERANCE = 20_000; // the first rope may start up to 2 points from the price shown
export const EXPIRY_LEAD_S = 2 * 3600;
export const MIN_ROPE_LIFE_S = 10 * 60;
export const MAKER_TREAT_BPS = 25n;
export const LEVERAGE_STEPS = [2, 3, 4, 5, 6, 8, 10] as const;
export const DEFAULT_LIVES = 9;
export const ROPE_LIVES = [
  { s: 10 * 60, label: "10 minutes" },
  { s: 30 * 60, label: "30 minutes" },
  { s: 3600, label: "1 hour" },
  { s: 4 * 3600, label: "4 hours" },
  { s: 24 * 3600, label: "1 day" },
  { s: 7 * 24 * 3600, label: "1 week" },
] as const;

/** What one leverage step gives: the rope length d (ppm, a whole number of ticks) and both leverages. */
export type PerpRope = { leverage: number; d: number; levMine: number; levTheirs: number; lower: number; upper: number };

/** The rope for the creator's side price `qSide` (ppm of the side's own chance) and its leverage. */
export function perpRope(side: 0 | 1, yesPpm: number, leverage: number): PerpRope {
  const qSide = side === 0 ? yesPpm : P - yesPpm;
  const d = Math.ceil(qSide / leverage / TICK) * TICK;
  return { leverage, d, levMine: qSide / d, levTheirs: (P - qSide) / d, lower: yesPpm - d, upper: yesPpm + d };
}

/**
 * Why the pot contract would refuse this rope at `yesPpm` (with the band `tol` either side), or
 * null. The same checks as HonorCatRopes' _checkRope for a symmetric rope.
 */
export function perpProblem(r: Pick<PerpRope, "d">, o: { yesPpm: number; tol: number; spread: number; crypto: boolean }): string | null {
  const max = maxLeverage(o.crypto);
  const lo = Math.max(0, o.yesPpm - o.tol);
  const hi = o.yesPpm + o.tol;
  if (r.d < minDistance(o.spread)) return `The posts must be at least ${(minDistance(o.spread) / 10_000).toFixed(0)} points from the price on this market.`;
  if (lo < r.d + POST_MARGIN || hi + r.d + POST_MARGIN > P) return "A post would be too close to 0 or 100: pick a lower leverage.";
  if (hi > max * r.d || P - lo > max * r.d) return `At most ${max}× on this market.`;
  return null;
}

/** The leverage steps that work now, each with its rope. */
export function perpSteps(side: 0 | 1, yesPpm: number, o: { spread: number; crypto: boolean }) {
  return LEVERAGE_STEPS.map((L) => perpRope(side, yesPpm, L)).filter((r) => !perpProblem(r, { yesPpm, tol: FIRST_TOLERANCE, ...o }));
}

/** Size (hundredths of a contract) and the exact stake per rope for a wanted stake of `wantBase`. */
export function stakeFor(d: number, wantBase: bigint) {
  const perSize = BigInt(d / TICK);
  const size = perSize > 0n ? wantBase / perSize : 0n;
  return { size, stake: size * perSize };
}

export const treatOf = (stake: bigint) => (stake * MAKER_TREAT_BPS) / 10_000n;

/** "6×", "4.5×": a leverage in words. */
export const times = (x: number) => `${Number.isInteger(Math.round(x * 10) / 10) ? Math.round(x) : (Math.round(x * 10) / 10).toFixed(1)}×`;
export const points = (ppm: number) => `${Math.round(ppm / 10_000)}`;

/** The short label used everywhere a perp is listed: "Perp, rope 10 points, 6× and 4×". */
export function perpLabel(d: number, levCreator: number, levJoiner: number) {
  return `Perp, rope ${points(d)} points, ${times(levCreator)} and ${times(levJoiner)}`;
}

/** Rope life in words. */
export function lifeWords(s: number) {
  const known = ROPE_LIVES.find((x) => x.s === s);
  if (known) return known.label;
  if (s % 86_400 === 0) return `${s / 86_400} days`;
  if (s % 3600 === 0) return `${s / 3600} hours`;
  return `${Math.round(s / 60)} minutes`;
}

/** Whether a first rope of `lifeS` still ends at least two hours before trading closes. */
export const lifeFits = (lifeS: number, closeMs: number, nowMs = Date.now()) => nowMs + lifeS * 1000 + EXPIRY_LEAD_S * 1000 <= closeMs;


/**
 * Whether a perp can be opened on a market now, for either side, and the highest leverage on offer:
 * the same rules as the perp form (posts inside 2..98, leverage cap, minimum distance, and the first
 * rope ending two hours before trading closes). `reason` says why not, in plain words.
 */
export function perpFit(m: { mid: number | null; spreadPpm: number; crypto: boolean; closeMs: number }, nowMs = Date.now()): { ok: true; maxLeverage: number } | { ok: false; reason: string } {
  if (m.mid === null) return { ok: false, reason: "No price right now" };
  if (!lifeFits(MIN_ROPE_LIFE_S, m.closeMs, nowMs)) return { ok: false, reason: "Closes too soon for a perp" };
  const yes = Math.round(m.mid * 1e6);
  const steps = [...perpSteps(0, yes, { spread: m.spreadPpm, crypto: m.crypto }), ...perpSteps(1, yes, { spread: m.spreadPpm, crypto: m.crypto })];
  if (!steps.length) return { ok: false, reason: yes < 150_000 || yes > 850_000 ? "Price too close to 0 or 100 for a perp" : "Spread too wide for a perp" };
  return { ok: true, maxLeverage: Math.max(...steps.map((s) => s.leverage)) };
}
