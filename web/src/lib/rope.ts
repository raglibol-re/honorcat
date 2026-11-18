/**
 * Short ropes (HonorCat v2) in plain numbers: the same rules as contracts/src/HonorCatRopes.sol, for
 * the create page and the rope view. Pure, no React (relay/test/rope-ui.test.ts checks it).
 *
 * Units as in the contract: prices in ppm (1,000,000 = 100%), posts on a 100 ppm grid (0.01
 * points), size in hundredths of a contract. A share is ticks × size USDC base units, so the two
 * shares always add up to the pot.
 */
export const P = 1_000_000;
export const TICK = 100;
export const MIN_DISTANCE = 50_000; // 5 points
export const EXPIRY_LEAD_S = 2 * 3600;
export const MAX_LIFE_S = 7 * 24 * 3600;
export const MIN_LIFE_S = 10 * 60;
export const MAX_LIVES = 8;
export const EXIT_FEE_BPS = 100;
export const MAKER_TREAT_BPS = 25;

export const maxLeverage = (crypto: boolean) => (crypto ? 10 : 5);
/** The shortest rope: 5 points, or twice the market's spread when that is wider. */
export const minDistance = (spreadPpm: number) => Math.max(MIN_DISTANCE, 2 * spreadPpm);
const grid = (ppm: number) => Math.floor(ppm / TICK) * TICK;

/** YES's share of `size` at `price` with posts [lower, upper] (clamped), and the pot. */
export function ropeShares(size: bigint, price: number, lower: number, upper: number) {
  const c = Math.min(upper, Math.max(lower, price));
  const yes = BigInt(Math.floor(c / TICK) - Math.floor(lower / TICK)) * size;
  const total = BigInt(Math.floor(upper / TICK) - Math.floor(lower / TICK)) * size;
  return { yes, no: total - yes, total };
}

export type RopeChoice = {
  /** The leverage asked for: 1 = a normal pot, no post. */
  leverage: number;
  /** Distance from the entry to the chooser's own post (ppm), 0 for none. */
  distance: number;
  distYes: number;
  distNo: number;
  lower: number;
  upper: number;
  /** Hundredths of a contract. */
  size: bigint;
  mine: bigint;
  theirs: bigint;
  pot: bigint;
};

/**
 * The rope for a stake: `side` puts in `stake` (USDC base units) at price `center` (ppm) with
 * `leverage` (1 = normal pot). The chooser's own post sits `center / leverage` away for YES
 * (`(100 − center) / leverage` for NO), rounded to the grid; the other side has no post.
 */
export function ropeFor(side: 0 | 1, center: number, stake: bigint, leverage: number): RopeChoice {
  const own = side === 0 ? center : P - center;
  const distance = leverage <= 1 ? 0 : grid(own / leverage);
  const distYes = side === 0 ? distance : 0;
  const distNo = side === 1 ? distance : 0;
  const e = grid(center);
  const lower = distYes ? e - distYes : 0;
  const upper = distNo ? e + distNo : P;
  const perContract = side === 0 ? Math.floor(e / TICK) - Math.floor(lower / TICK) : Math.floor(upper / TICK) - Math.floor(e / TICK);
  const size = perContract > 0 ? stake / BigInt(perContract) : 0n;
  const s = ropeShares(size, e, lower, upper);
  const mine = side === 0 ? s.yes : s.no;
  return { leverage, distance, distYes, distNo, lower, upper, size, mine, theirs: s.total - mine, pot: s.total };
}

/** Why a rope cannot be offered (null when it can), by the contract's own limits. */
export function ropeProblem(c: RopeChoice, o: { side: 0 | 1; center: number; tolerance: number; spread: number; crypto: boolean }) {
  if (c.leverage <= 1) return null;
  const own = o.side === 0 ? o.center + o.tolerance : P - (o.center - o.tolerance); // worst entry in the band
  if (c.distance < minDistance(o.spread)) return `The price moves about ${(o.spread / 10_000).toFixed(0)} points between buyers and sellers here, so the rope must be at least ${(minDistance(o.spread) / 10_000).toFixed(0)} points long.`;
  if (own > maxLeverage(o.crypto) * c.distance) return `This market allows at most ${maxLeverage(o.crypto)}× (${o.crypto ? "crypto" : "not a crypto market"}).`;
  const lo = o.center - o.tolerance;
  const hi = o.center + o.tolerance;
  if (o.side === 0 && lo < c.distance + TICK) return "Your post would fall below 0: choose less leverage.";
  if (o.side === 1 && hi + c.distance + TICK > P) return "Your post would go above 100: choose less leverage.";
  return null;
}

/** The leverage steps to offer: 1×, then 2×, 3×, 5×, 10× while allowed. */
export function leverageSteps(o: { side: 0 | 1; center: number; tolerance: number; spread: number; crypto: boolean }) {
  return [1, 2, 3, 5, 10].filter((l) => l <= maxLeverage(o.crypto) && ropeProblem(ropeFor(o.side, o.center, 1_000_000n, l), o) === null);
}

const pts = (ppm: number) => `${(ppm / 10_000).toFixed(ppm % 10_000 === 0 ? 0 : 1)}`;

/** The rope in plain words, e.g. "A 10-point move doubles your stake." */
export function ropeWords(side: 0 | 1, c: RopeChoice, sideName: string) {
  if (c.leverage <= 1) return { doubles: null, loseAll: null, short: null };
  const towards = side === 0 ? "rises" : "falls";
  const post = side === 0 ? c.lower : c.upper;
  return {
    doubles: `A ${pts(c.distance)}-point move doubles your stake: if the chance of “${sideName}” ${towards} by ${pts(c.distance)} points, your side is worth twice what you put in.`,
    loseAll: `You can lose your whole stake if the price ${side === 0 ? "falls" : "rises"} to ${pts(post)}.`,
    short: `${c.leverage}× · post at ${pts(post)}`,
  };
}

/** Expiry choices (unix seconds) a rope may have now: at least 10 minutes, at most 7 days, 2 hours before close. */
export function expiryChoices(nowS: number, closeS: number) {
  const latest = Math.min(nowS + MAX_LIFE_S, closeS - EXPIRY_LEAD_S);
  const options = [
    { label: "1 hour", s: 3600 },
    { label: "6 hours", s: 6 * 3600 },
    { label: "1 day", s: 24 * 3600 },
    { label: "3 days", s: 3 * 24 * 3600 },
    { label: "7 days", s: 7 * 24 * 3600 },
  ]
    .map((o) => ({ label: o.label, at: nowS + o.s }))
    .filter((o) => o.at <= latest);
  if (latest >= nowS + MIN_LIFE_S && !options.some((o) => o.at === latest)) options.push({ label: "until 2 hours before trading closes", at: latest });
  return options;
}

/** "2 h 05 min", "3 days 4 h", "4 min 10 s": the time left until `atS`. */
export function countdown(atS: number, nowS: number) {
  const d = Math.max(0, atS - nowS);
  const days = Math.floor(d / 86_400);
  const h = Math.floor((d % 86_400) / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ${h} h`;
  if (h > 0) return `${h} h ${String(m).padStart(2, "0")} min`;
  return `${m} min ${String(s).padStart(2, "0")} s`;
}
