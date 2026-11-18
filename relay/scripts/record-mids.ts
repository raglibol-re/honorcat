/**
 * Records Gemini midpoints for the short-rope backtest (docs/rope-design.md section 8): every
 * `--every` seconds (default 15) it reads the order book of each market in
 * scripts/recorder-markets.json, round-robin so Gemini sees at most about 2 requests a second, and
 * appends one line per reading to data/recorder/mids.jsonl (git-ignored: raw prices never go into
 * the repository; scripts/rope-backtest.ts writes only aggregates).
 *
 * Run: cd relay && npx tsx scripts/record-mids.ts [--every 15] [--hours 40]
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { readBook } from "../src/gemini";
import { bookStats } from "../src/catalog";

const arg = (k: string, d: number) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? Number(process.argv[i + 1]) : d;
};
const every = arg("every", 15) * 1000;
const until = Date.now() + arg("hours", 40) * 3600_000;
const markets = JSON.parse(readFileSync(new URL("./recorder-markets.json", import.meta.url), "utf8")) as { symbol: string; category: string; closeMs: number; startMs: number | null }[];
const dir = new URL("../../data/recorder/", import.meta.url);
mkdirSync(dir, { recursive: true });
const out = new URL("mids.jsonl", dir);
const gap = every / markets.length;
console.log(`recording ${markets.length} markets every ${every / 1000} s until ${new Date(until).toISOString()} -> ${out.pathname}`);

let n = 0;
while (Date.now() < until) {
  const round = Date.now();
  for (const m of markets) {
    if (Date.now() > m.closeMs) continue;
    const t = Date.now();
    const raw = await readBook(m.symbol, { levels: 5, timeoutMs: 4000 });
    if (raw) {
      const s = bookStats(raw, t);
      appendFileSync(out, JSON.stringify({ t, s: m.symbol, c: m.category, bid: s.bid, ask: s.ask, bd: s.bidDepth, ad: s.askDepth }) + "\n");
      n++;
    }
    const wait = gap - (Date.now() - t);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  if (n % 500 < markets.length) console.log(`${new Date().toISOString()} ${n} readings`);
  const rest = every - (Date.now() - round);
  if (rest > 0) await new Promise((r) => setTimeout(r, rest));
}
console.log(`done: ${n} readings`);
