/**
 * Fairness evidence for short ropes (docs/rope-design.md section 8, spec section 8).
 *
 * The linear deposits (YES puts in q − L, NO puts in U − q per contract) are exactly fair only when
 * overshoot past U and past L is equally likely and equally large: with the price a martingale and
 * p* the division price, E[clamp(p*, L, U)] = q − E[(p* − U)+] + E[(L − p*)+]. So the fair YES deposit
 * is (q − L) − E[overshoot above U] + E[overshoot below L]; the "bias" below is that correction, in
 * points, positive when YES should have put in more.
 *
 * Three sources, one rope rule (the contract's): a knock-out is triggered when the smoothed price
 * holds at or beyond a post, then priced over the next window and divided at the clamped price; at
 * expiry the pot is divided at the clamped price.
 *  1. simulation: a binary market whose price is the exact conditional probability under small moves
 *     plus jumps (so it is a martingale), at several distances from resolution;
 *  2. model-based crypto: Gemini's public BTC 15-minute candles turned into daily "BTC up" contracts
 *     priced with a digital-option model (labelled as model-based, not market-observed);
 *  3. recorded: our own recorded midpoints (data/recorder/mids.jsonl, scripts/record-mids.ts), per
 *     market type, live games separately. Raw prices never leave data/; only aggregates are written.
 *
 * Run: cd relay && npx tsx scripts/rope-backtest.ts [--paths 1500]
 * Writes docs/backtest/rope-backtest.json and prints the tables used in docs/rope-backtest.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const argN = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};

/* ------------------------------------------------------------------ maths */

function erf(x: number) {
  // Abramowitz and Stegun 7.1.26 (|error| < 1.5e-7)
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const Phi = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2));

/** Seeded PRNG (mulberry32) and standard normals, so every run gives the same numbers. */
function rng(seed: number) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const n = () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
  const pois = (lam: number) => {
    let k = 0;
    let p = Math.exp(-lam);
    let s = p;
    const x = u();
    while (x > s && k < 50) {
      k++;
      p *= lam / k;
      s += p;
    }
    return k;
  };
  return { u, n, pois };
}

/* ------------------------------------------------------------------ the rope rule on one path */

type Outcome = { end: "upper" | "lower" | "expiry"; price: number; overU: number; overL: number; yes: number };

/**
 * Applies the rope rule to a price path sampled every `dt` seconds (prices 0..1). The smoothed price
 * is the mean of the last `trig` samples; once it is at or beyond a post a knock-out is filed and the
 * pot is divided at the mean of the next `fwd` samples, clamped. Otherwise the pot is divided at the
 * expiry (the mean of the `fwd` samples after it). Returns which end, the division price, the
 * overshoot past each post and YES's share per contract (in probability units).
 */
function ropeOn(path: number[], L: number, U: number, trig: number, fwd: number): Outcome {
  const end = path.length - fwd;
  for (let i = trig; i < end; i++) {
    let s = 0;
    for (let j = i - trig; j < i; j++) s += path[j]!;
    const sm = s / trig;
    if (sm <= L || sm >= U) {
      let f = 0;
      for (let j = i; j < i + fwd; j++) f += path[j]!;
      const p = f / fwd;
      return { end: sm <= L ? "lower" : "upper", price: p, overU: Math.max(0, p - U), overL: Math.max(0, L - p), yes: Math.min(U, Math.max(L, p)) - L };
    }
  }
  let f = 0;
  for (let j = end; j < path.length; j++) f += path[j]!;
  const p = f / fwd;
  return { end: "expiry", price: p, overU: Math.max(0, p - U), overL: Math.max(0, L - p), yes: Math.min(U, Math.max(L, p)) - L };
}

type Row = Record<string, string | number>;

function summarise(outs: Outcome[], q: number, L: number, U: number): Row {
  const n = outs.length;
  const up = outs.filter((o) => o.end === "upper").length;
  const lo = outs.filter((o) => o.end === "lower").length;
  const touched = up + lo;
  const mean = (f: (o: Outcome) => number, xs = outs) => (xs.length ? xs.reduce((s, o) => s + f(o), 0) / xs.length : 0);
  const knocked = outs.filter((o) => o.end !== "expiry");
  // bias: what YES should have put in minus what it did (points); positive = the linear rule favours YES
  const fair = mean((o) => o.yes);
  return {
    pots: n,
    upperFirst: +(touched ? up / touched : 0).toFixed(3),
    linearPrediction: +((q - L) / (U - L)).toFixed(3),
    knockedOut: +(touched / n).toFixed(3),
    meanOvershootUpperPts: +(100 * mean((o) => o.overU, knocked)).toFixed(2),
    meanOvershootLowerPts: +(100 * mean((o) => o.overL, knocked)).toFixed(2),
    maxOvershootPts: +(100 * Math.max(0, ...knocked.map((o) => Math.max(o.overU, o.overL)))).toFixed(1),
    biasYesPts: +(100 * (fair - (q - L))).toFixed(2),
  };
}

/* ------------------------------------------------------------------ 1. simulation */

/**
 * A binary event "X_T > 0" where X moves by small normal steps (variance 1 per day) plus jumps
 * (Poisson rate `lam` per day, normal size with sd `js`). The market price is the exact probability
 * given X_t: sum over the number of remaining jumps of Poisson weight × Φ(X_t / sqrt(τ + k·js²)).
 * The rope starts with 6 hours to run and expires `leadH` hours before resolution.
 */
function simulate(o: { lam: number; js: number; leadH: number; d: number; paths: number; seed: number; lifeH?: number; q0?: number }) {
  const r = rng(o.seed);
  const dt = 60; // seconds
  const day = 86_400;
  const life = (o.lifeH ?? 6) * 3600;
  const steps = Math.round(life / dt);
  const outs: Outcome[] = [];
  const price = (x: number, tau: number) => {
    // τ in days
    let p = 0;
    let w = Math.exp(-o.lam * tau);
    const kMax = Math.ceil(o.lam * tau + 10 * Math.sqrt(o.lam * tau + 1) + 5); // all but a negligible Poisson tail
    for (let k = 0; k <= kMax; k++) {
      if (k > 0) w *= (o.lam * tau) / k;
      const v = tau + k * o.js * o.js;
      p += w * (v <= 1e-12 ? (x > 0 ? 1 : 0) : Phi(x / Math.sqrt(v)));
    }
    return Math.min(1, Math.max(0, p));
  };
  // start where the price is q0 (default 50%): the X with that probability, by bisection
  const tau0 = (o.leadH * 3600 + life) / day;
  let lo = -20;
  let hi = 20;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (price(mid, tau0) < (o.q0 ?? 0.5)) lo = mid;
    else hi = mid;
  }
  const x0 = (lo + hi) / 2;
  const q = price(x0, tau0);
  const L = q - o.d;
  const U = q + o.d;
  for (let i = 0; i < o.paths; i++) {
    let x = x0;
    const path: number[] = [];
    for (let s = 0; s <= steps + 1; s++) {
      const tau = Math.max(0, tau0 - (s * dt) / day);
      path.push(price(x, tau));
      x += Math.sqrt(dt / day) * r.n();
      const k = r.pois((o.lam * dt) / day);
      for (let j = 0; j < k; j++) x += o.js * r.n();
    }
    outs.push(ropeOn(path, L, U, 1, 1)); // 60 s trigger window, 60 s forward window
  }
  return { q, L, U, ...summarise(outs, q, L, U) };
}

/* ------------------------------------------------------------------ 2. model-based crypto (Gemini BTC candles) */

async function cryptoModel(d: number) {
  const r = await fetch("https://api.gemini.com/v2/candles/btcusd/15m", { signal: AbortSignal.timeout(20_000) });
  const raw = (await r.json()) as [number, number, number, number, number, number][];
  const c = raw.map((x) => ({ t: x[0], close: x[4] })).sort((a, b) => a.t - b.t);
  const rets = c.slice(1).map((x, i) => Math.log(x.close / c[i]!.close));
  const sd15 = Math.sqrt(rets.reduce((s, v) => s + v * v, 0) / rets.length); // per 15 minutes
  const sdDay = sd15 * Math.sqrt(96);
  const outs: Outcome[] = [];
  const contractH = 24;
  const leadH = 2; // the contract's rule: expiry at least 2 h before close
  const steps = (contractH - leadH) * 4;
  let q = 0.5;
  for (let s = 0; s + contractH * 4 < c.length; s += 4) {
    // a daily "BTC above today's open" contract opening at candle s, priced with the realised volatility
    const K = c[s]!.close;
    const path: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const tau = (contractH * 4 - i) / 96; // days
      path.push(Phi(Math.log(c[s + i]!.close / K) / (sdDay * Math.sqrt(tau))));
    }
    q = path[0]!;
    outs.push(ropeOn(path, q - d, q + d, 1, 1)); // 15-minute samples: trigger and forward of one candle
  }
  return { source: "Gemini BTC/USD 15-minute candles", from: new Date(c[0]!.t).toISOString(), to: new Date(c[c.length - 1]!.t).toISOString(), dailyVol: +sdDay.toFixed(4), q: 0.5, L: 0.5 - d, U: 0.5 + d, ...summarise(outs, 0.5, 0.5 - d, 0.5 + d) };
}

/* ------------------------------------------------------------------ 3. recorded midpoints */

function recorded(d: number, lifeH: number) {
  const f = new URL("../../data/recorder/mids.jsonl", import.meta.url);
  if (!existsSync(f)) return [];
  const markets = JSON.parse(readFileSync(new URL("./recorder-markets.json", import.meta.url), "utf8")) as { symbol: string; category: string; startMs: number | null }[];
  const byS = new Map<string, { t: number; mid: number }[]>();
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line) continue;
    const x = JSON.parse(line) as { t: number; s: string; bid: number | null; ask: number | null };
    if (x.bid === null || x.ask === null) continue;
    if (!byS.has(x.s)) byS.set(x.s, []);
    byS.get(x.s)!.push({ t: x.t, mid: (x.bid + x.ask) / 2 });
  }
  const groups = new Map<string, { outs: Outcome[]; hours: number }>();
  for (const m of markets) {
    const xs = byS.get(m.symbol) ?? [];
    if (xs.length < 20) continue;
    const span = (xs[xs.length - 1]!.t - xs[0]!.t) / 3_600_000;
    // a rope opened every 30 minutes along the recording, running for `lifeH` hours (or to the end)
    for (let i = 0; i < xs.length; i++) {
      if (i > 0 && xs[i]!.t - xs[0]!.t < 0) continue;
      const t0 = xs[i]!.t;
      if ((t0 - xs[0]!.t) % 1_800_000 > 15_000) continue;
      const seg = xs.filter((x) => x.t >= t0 && x.t <= t0 + lifeH * 3_600_000).map((x) => x.mid);
      if (seg.length < 10) continue;
      const q = seg[0]!;
      if (q - d <= 0.01 || q + d >= 0.99) continue;
      const live = m.startMs !== null && t0 >= m.startMs;
      const key = m.category === "Sports" ? (live ? "Sports (during the game)" : m.startMs !== null ? "Sports (before the game)" : "Sports (season-long)") : m.category;
      if (!groups.has(key)) groups.set(key, { outs: [], hours: 0 });
      // samples are ~15 s apart: trigger on 2 (30 s), divide on the next 2 (30 s), as the pots do
      groups.get(key)!.outs.push(ropeOn(seg, q - d, q + d, 2, 2)); // YES's share is measured from its own L = q − d
    }
    void span;
  }
  return [...groups.entries()].map(([k, g]) => {
    // q differs per rope; report symmetric-rope numbers (L = q − d, U = q + d): linear rule says 50/50
    const s = summarise(g.outs, 0.5, 0.5 - d, 0.5 + d);
    return { group: k, ...s };
  });
}

/* ------------------------------------------------------------------ run */

const paths = argN("paths", 1500);
const result: Record<string, unknown> = { generated: new Date().toISOString(), note: "aggregates only; bias = fair YES deposit minus the linear deposit, in points (positive: YES should have put in more)" };

const sim: Row[] = [];
let seed = 1;
for (const jumps of [
  { name: "small moves only", lam: 0, js: 0 },
  { name: "small moves plus jumps", lam: 6, js: 0.6 },
]) {
  for (const q0 of [0.5, 0.8]) {
    for (const leadH of [72, 24, 6, 2, 0.5]) {
      for (const d of [0.05, 0.1]) {
        const s = simulate({ lam: jumps.lam, js: jumps.js, leadH, d, paths, seed: seed++, q0 });
        sim.push({ model: jumps.name, entry: q0, hoursToResolutionAtExpiry: leadH, ropePts: d * 100, ...s, q: +s.q.toFixed(3), L: +s.L.toFixed(3), U: +s.U.toFixed(3) });
      }
    }
  }
}
result.simulation = sim;

try {
  result.cryptoModel = await Promise.all([0.05, 0.1, 0.2].map(async (d) => ({ ropePts: d * 100, ...(await cryptoModel(d)) })));
} catch (e) {
  result.cryptoModel = { error: (e as Error).message };
}

result.recorded = [0.05, 0.1].flatMap((d) => recorded(d, 6).map((r) => ({ ropePts: d * 100, ropeHours: 6, ...r })));

const dir = new URL("../../docs/backtest/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL("rope-backtest.json", dir), JSON.stringify(result, null, 2) + "\n");

const table = (rows: Row[], cols: string[]) => {
  const out = [`| ${cols.join(" | ")} |`, `|${cols.map(() => "---").join("|")}|`];
  for (const r of rows) out.push(`| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`);
  return out.join("\n");
};
console.log("## Simulation\n");
console.log(table(sim, ["model", "entry", "hoursToResolutionAtExpiry", "ropePts", "pots", "knockedOut", "upperFirst", "linearPrediction", "meanOvershootUpperPts", "meanOvershootLowerPts", "maxOvershootPts", "biasYesPts"]));
console.log("\n## Model-based crypto\n");
console.log(Array.isArray(result.cryptoModel) ? table(result.cryptoModel as Row[], ["ropePts", "pots", "knockedOut", "upperFirst", "linearPrediction", "meanOvershootUpperPts", "meanOvershootLowerPts", "maxOvershootPts", "biasYesPts", "dailyVol", "from", "to"]) : JSON.stringify(result.cryptoModel));
console.log("\n## Recorded\n");
console.log(table(result.recorded as Row[], ["group", "ropePts", "ropeHours", "pots", "knockedOut", "upperFirst", "linearPrediction", "meanOvershootUpperPts", "meanOvershootLowerPts", "maxOvershootPts", "biasYesPts"]));
