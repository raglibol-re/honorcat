"use client";


import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { TypedDataDefinition } from "viem";
import { MarketPicker, type PickerMarket } from "@/components/guarantee/MarketPicker";
import { getJson, usePolling } from "@/lib/api";
import { useWallet } from "@/lib/wallet/context";

type Contract = { ticker: string; label: string; chanceYes: number | null; instrument: string | null };
type Market = PickerMarket & { contracts: Contract[] };
type MarketsResponse = { category: string; categories: string[]; markets: Market[] };
type Demo = { eventTicker: string; contractTicker: string; title: string; label: string; image: string | null; category: string; side: "yes" | "no"; chance: number; closesAt: string };
type Prepared = {
  terms: Record<string, unknown> & { promise: string; template: string; lockTime: number };
  seal: string;
  amount: string;
  salt: `0x${string}`;
  validAfter: string;
  validBefore: string;
  typedData: { domain: Record<string, unknown>; types: Record<string, unknown>; primaryType: string; message: Record<string, string> };
};

const post = <T,>(path: string, body: unknown) => getJson<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

/** Recent trade prices as a small line, labelled as such (no bid/ask history exists). */
function TradeChart({ symbol, side }: { symbol: string | null; side: "yes" | "no" }) {
  const { data } = usePolling<{ points: { t: number; price: number }[] }>(symbol ? `/api/early/history?symbol=${symbol}&tf=5m` : null, 60_000);
  const pts = (data?.points ?? []).map((p) => ({ t: p.t, v: side === "yes" ? p.price : 1 - p.price }));
  if (!symbol || pts.length < 2) return <p className="t-13" style={{ color: "var(--vg-muted)" }}>No recent trades to show.</p>;
  const W = 300;
  const H = 60;
  const t0 = pts[0]!.t;
  const t1 = pts.at(-1)!.t;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(((p.t - t0) / Math.max(1, t1 - t0)) * W).toFixed(1)},${((1 - p.v) * H).toFixed(1)}`).join("");
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-16 w-full" role="img" aria-label="Recent trade prices">
        <path d={d} fill="none" stroke="var(--vg-muted)" strokeWidth="1.5" />
      </svg>
      <figcaption className="t-13" style={{ color: "var(--vg-muted)" }}>
        Recent price, based on trade prices (last {Math.round((t1 - t0) / 3_600_000) || 1} h). Not the rule that pays.
      </figcaption>
    </figure>
  );
}

export function NewEarly() {
  const [category, setCategory] = useState("Crypto");
  const { data, error } = usePolling<MarketsResponse>(`/api/early/markets?category=${category}`, 20_000);
  const markets = data?.category === category ? data.markets : null;
  const [picked, setPicked] = useState<{ ticker: string; idx: number } | null>(null);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [threshold, setThreshold] = useState(85);
  const [mode, setMode] = useState<"early-only" | "early-or-outcome">("early-only");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [count, setCount] = useState(10);
  const [joinMin, setJoinMin] = useState(2);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const market = markets?.find((m) => m.ticker === picked?.ticker) ?? null;
  const contract = market ? (market.contracts[picked?.idx ?? 0] ?? null) : null;
  const chance = contract?.chanceYes == null ? null : side === "yes" ? contract.chanceYes : 1 - contract.chanceYes;

  async function useDemo() {
    setDemoNote("Finding the live market that best fits a demo right now…");
    try {
      const d = await getJson<{ trigger: Demo[] }>("/api/early/demo");
      const c = d.trigger[0];
      if (!c) throw new Error("No live market meets the demo rules right now. Pick one yourself or try again in a minute.");
      const cat = c.category || (await findCategory(c.eventTicker));
      setCategory(cat);
      setPicked({ ticker: c.eventTicker, idx: -1 });
      setDemo(true);
      setSide(c.side);
      setThreshold(85);
      setMode("early-only");
      setJoinMin(1);
      setCount(3);
      setAmount("0.10");
      if (!name) setName("Demo");
      setDemoNote(`Demo market: ${c.title}, “${c.label}” ${c.side === "no" ? "does not happen" : "happens"}, at ${Math.round(c.chance * 100)}% now. Its order book meets the demo rules.`);
      pendingDemo = c;
    } catch (e) {
      setDemoNote(e instanceof Error ? e.message : String(e));
    }
  }

  // Resolve the demo's contract index once the category's markets have loaded.
  useEffect(() => {
    if (!markets || !pendingDemo || picked?.idx !== -1) return;
    const m = markets.find((x) => x.ticker === pendingDemo!.eventTicker);
    const idx = m?.contracts.findIndex((c) => c.ticker === pendingDemo!.contractTicker) ?? -1;
    if (m && idx >= 0) {
      const ticker = m.ticker;
      Promise.resolve().then(() => setPicked({ ticker, idx }));
      pendingDemo = null;
    }
  }, [markets, picked]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-7">
        <section className="vg-ticket space-y-2 px-5 py-4">
          <h2 className="t-17 font-medium">Try it in two minutes</h2>
          <p className="t-15" style={{ color: "var(--vg-muted)" }}>
            Picks the live Gemini market whose order book best fits a quick demo, with test money and three places.
          </p>
          <button type="button" onClick={useDemo} className="t-15 rounded-xl px-4 py-2.5 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
            Use the demo market
          </button>
          {demoNote && <p className="t-13">{demoNote}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="t-17 font-medium">Which event?</h2>
          <div className="t-13 flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
            {(data?.categories ?? ["Crypto", "Weather", "Economics", "Commodities", "Sports", "Politics", "Culture"]).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={category === c}
                onClick={() => {
                  setCategory(c);
                  setPicked(null);
                  setDemo(false);
                }}
                className="rounded-full border px-3 py-1.5"
                style={category === c ? { borderColor: "var(--vg-accent)", color: "var(--vg-accent)", background: "var(--vg-accent-soft)" } : { borderColor: "var(--vg-rule)" }}
              >
                {c}
              </button>
            ))}
          </div>
          {error && !markets && <p className="t-15" style={{ color: "var(--negative)" }}>{error}</p>}
          {!markets && !error && <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading live markets from Gemini…</p>}
          {markets && markets.length === 0 && <p className="t-15">No open market in this category right now. Try another one.</p>}
          {markets && markets.length > 0 && (
            <MarketPicker
              markets={markets}
              market={market}
              contract={contract}
              onPick={(ticker, idx) => {
                setPicked({ ticker, idx });
                setDemo(false);
              }}
            />
          )}
        </section>

        {contract && (
          <section className="space-y-4">
            <fieldset>
              <legend className="t-15 font-medium">Pay everyone early when it becomes likely that…</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {(["yes", "no"] as const).map((s) => (
                  <label key={s} className="t-15 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5" style={side === s ? { borderColor: "var(--vg-accent)", boxShadow: "0 0 0 1px var(--vg-accent)" } : { borderColor: "var(--vg-rule)" }}>
                    <input type="radio" name="side" className="sr-only" checked={side === s} onChange={() => setSide(s)} />
                    {s === "yes" ? `“${contract.label}” happens` : `“${contract.label}” does not happen`}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="t-15 font-medium">
                …with a chance of at least <span className="mono">{threshold}%</span>
              </span>
              <input type="range" min={60} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 w-full" style={{ accentColor: "var(--vg-accent)" }} />
              <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                Now: {pct(chance)} (Gemini market estimate). Market closes {new Date(market!.expiry).toLocaleString()}.
              </span>
            </label>
            <TradeChart symbol={contract.instrument} side={side} />
            <fieldset>
              <legend className="t-15 font-medium">If it never gets that likely</legend>
              <div className="mt-2 space-y-2">
                {(
                  [
                    ["early-only", "Give the money back to me when trading closes"],
                    ["early-or-outcome", "Still pay everyone if the event happens; otherwise give it back"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="t-15 flex cursor-pointer items-center gap-2">
                    <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} style={{ accentColor: "var(--vg-accent)" }} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Your name, as recipients will see it
            </span>
            <input className="t-15 mt-1 w-full rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbor Kayak Tours" />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Each person gets (USDC)
            </span>
            <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              People (max 50)
            </span>
            <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </label>
          <label className="block sm:col-span-2">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              People can join for (minutes); watching starts after that
            </span>
            <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} type="number" min={1} value={joinMin} onChange={(e) => setJoinMin(Math.max(1, Number(e.target.value) || 1))} />
          </label>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <section className="vg-ticket px-5 py-4">
          <h2 className="t-17 font-medium">What it costs</h2>
          <dl className="mt-3 space-y-2">
            <div className="flex justify-between">
              <dt className="t-15">Set aside now</dt>
              <dd className="mono t-17">${((Number(amount) || 0) * count).toFixed(2)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="t-15">Chance it pays early, today’s estimate</dt>
              <dd className="mono t-17">{chance === null ? "—" : chance >= threshold / 100 ? "likely" : pct(chance)}</dd>
            </div>
          </dl>
          <p className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
            An early payout is final, even if the market turns out wrong. Unused places come back to you.
          </p>
        </section>
        <Fund market={market} contract={contract} side={side} threshold={threshold} mode={mode} name={name} amount={amount} count={count} joinMin={joinMin} demo={demo} />
      </aside>
    </div>
  );
}

let pendingDemo: Demo | null = null;

async function findCategory(eventTicker: string): Promise<string> {
  for (const c of ["Crypto", "Weather", "Economics", "Commodities", "Sports", "Politics", "Culture"]) {
    const r = await getJson<MarketsResponse>(`/api/early/markets?category=${c}`).catch(() => null);
    if (r?.markets.some((m) => m.ticker === eventTicker)) return c;
  }
  return "Crypto";
}

function Fund(p: { market: Market | null; contract: Contract | null; side: "yes" | "no"; threshold: number; mode: "early-only" | "early-or-outcome"; name: string; amount: string; count: number; joinMin: number; demo: boolean }) {
  const { connect, adapter } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; promise: string } | null>(null);
  const ready = p.market && p.contract && p.name.trim() && Number(p.amount) >= 0.01 && Number(p.amount) * p.count >= 0.1;

  async function fund() {
    if (!p.market || !p.contract) return;
    setErr(null);
    try {
      setBusy("Connect your wallet…");
      const funder = await connect();
      if (!funder) throw new Error("Wallet not connected");
      setBusy("Preparing the terms…");
      const prep = await post<Prepared>("/api/early/prepare", {
        name: p.name.trim(),
        funder,
        eventTicker: p.market.ticker,
        contractTicker: p.contract.ticker,
        side: p.side,
        mode: p.mode,
        thresholdBps: p.threshold * 100,
        amount: Number(p.amount).toFixed(2),
        maxRecipients: p.count,
        joinSeconds: p.joinMin * 60,
        template: p.demo ? "demo" : undefined,
      });
      setBusy("Confirm once in your wallet. No fees.");
      const m = prep.typedData.message;
      const signature = await adapter.signTypedData({
        domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
      } as unknown as TypedDataDefinition);
      setBusy("Setting the money aside…");
      const created = await post<{ id: string }>("/api/early", {
        terms: prep.terms,
        seal: prep.seal,
        authorization: { from: funder, validAfter: prep.validAfter, validBefore: prep.validBefore, salt: prep.salt, signature },
      });
      setDone({ id: created.id, promise: prep.terms.promise });
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0]! : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (done) return <Share id={done.id} promise={done.promise} />;
  return (
    <section className="vg-ticket px-5 py-4">
      <button type="button" onClick={fund} disabled={!ready || busy !== null} className="t-15 w-full rounded-xl px-4 py-3 font-medium disabled:opacity-50" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
        Set aside ${((Number(p.amount) || 0) * p.count).toFixed(2)} and publish
      </button>
      <p className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
        {busy ?? (ready ? "You confirm once in your wallet. No approval step and no network fees." : "Choose a market, then enter your name and an amount (at least $0.10 in total).")}
      </p>
      {err && <p className="t-13 mt-2" style={{ color: "var(--negative)" }}>{err}</p>}
    </section>
  );
}

function Share({ id, promise }: { id: string; promise: string }) {
  const url = useMemo(() => (typeof window === "undefined" ? `/e/${id}` : `${window.location.origin}/e/${id}`), [id]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, width: 180 }).then(setQr).catch(() => setQr(null));
  }, [url]);
  return (
    <section className="vg-ticket space-y-3 px-5 py-4">
      <h2 className="t-17 font-medium">It is live</h2>
      <p className="t-13" style={{ color: "var(--vg-muted)" }}>
        {promise}
      </p>
      <input readOnly value={url} onFocus={(e) => e.target.select()} className="mono t-13 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-page)" }} aria-label="Share link" />
      {qr && <div className="w-[180px] rounded-lg bg-white p-1" aria-label="QR code for the share link" dangerouslySetInnerHTML={{ __html: qr }} />}
      <a href={`/e/${id}`} className="t-15 block underline underline-offset-4">
        Open the page people join
      </a>
    </section>
  );
}
