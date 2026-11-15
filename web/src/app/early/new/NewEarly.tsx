"use client";


import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import type { TypedDataDefinition } from "viem";
import { MarketPicker, type PickerMarket } from "@/components/guarantee/MarketPicker";
import { getJson, usePolling } from "@/lib/api";
import { formatAxis } from "@/lib/format";
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

/** Recent trade prices with axes and the threshold, labelled as such (no bid/ask history exists). */
function TradeChart({ symbol, side, threshold }: { symbol: string | null; side: "yes" | "no"; threshold: number }) {
  const { data } = usePolling<{ points: { t: number; price: number }[] }>(symbol ? `/api/early/history?symbol=${symbol}&tf=5m` : null, 60_000);
  const pts = (data?.points ?? []).map((p) => ({ t: p.t, v: side === "yes" ? p.price : 1 - p.price }));
  if (symbol && !data) return <div className="h-[200px] animate-pulse rounded-lg" style={{ background: "var(--vg-rule)", opacity: 0.3 }} aria-hidden />;
  if (!symbol || pts.length < 2) return null;
  const W = 480;
  const H = 220;
  const pad = { l: 50, r: 10, t: 12, b: 34 };
  const FS = 17;
  const t0 = pts[0]!.t;
  const t1 = Math.max(pts.at(-1)!.t, t0 + 1);
  const vs = pts.map((p) => p.v);
  const lo = Math.max(0, Math.min(threshold - 0.1, ...vs) - 0.03);
  const hi = Math.min(1, Math.max(threshold + 0.05, ...vs) + 0.03);
  const x = (t: number) => pad.l + ((t - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / Math.max(0.0001, hi - lo)) * (H - pad.t - pad.b);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const yTicks = [...new Set([lo, hi].map((v) => Math.round(v * 100)))].filter((v) => Math.abs(v - threshold * 100) >= 3);
  const xTicks = [t0, (t0 + t1) / 2, t1];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Recent trade prices, threshold ${Math.round(threshold * 100)}%`}>
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke="var(--vg-rule)" />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke="var(--vg-rule)" />
        {yTicks.map((v) => (
          <text key={v} x={pad.l - 6} y={y(v / 100) + 6} textAnchor="end" fontSize={FS} fill="var(--vg-muted)">
            {v}%
          </text>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={FS} fill="var(--vg-muted)">
            {formatAxis(t, t1 - t0)}
          </text>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke="var(--vg-ink)" strokeDasharray="5 4" strokeWidth="1.2" opacity="0.8" />
        <text x={pad.l - 6} y={y(threshold) + 6} textAnchor="end" fontSize={FS} fontWeight="600" fill="var(--vg-ink)">
          {Math.round(threshold * 100)}%
        </text>
        <path d={d} fill="none" stroke="var(--vg-accent)" strokeWidth="2.5" />
      </svg>
      <figcaption className="t-13" style={{ color: "var(--vg-muted)" }}>
        Recent trade prices. Dashed: your {Math.round(threshold * 100)}% line.
      </figcaption>
    </figure>
  );
}

export function NewEarly() {
  const [category, setCategory] = useState("Crypto");
  const [include, setInclude] = useState<string | null>(null);
  const { data, error } = usePolling<MarketsResponse>(`/api/early/markets?category=${category}${include ? `&include=${encodeURIComponent(include)}` : ""}`, 20_000);
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
  const pendingDemo = useRef<Demo | null>(null);

  const market = markets?.find((m) => m.ticker === picked?.ticker) ?? null;
  const contract = market ? (market.contracts[picked?.idx ?? 0] ?? null) : null;
  const chance = contract?.chanceYes == null ? null : side === "yes" ? contract.chanceYes : 1 - contract.chanceYes;

  async function pickDemo(kind: "trigger" | "watch") {
    setDemoNote("Finding one…");
    try {
      const d = await getJson<{ trigger: Demo[]; watch?: Demo[] }>("/api/early/demo");
      const c = (kind === "watch" ? d.watch : d.trigger)?.[0];
      if (!c)
        throw new Error(
          kind === "watch"
            ? "No market is just below 85% right now. Try the instant demo or pick an event below."
            : "None right now. Pick an event below or try again in a minute.",
        );
      const cat = c.category || (await findCategory(c.eventTicker));
      setCategory(cat);
      setInclude(c.eventTicker);
      setPicked({ ticker: c.eventTicker, idx: -1 });
      setDemo(true);
      setSide(c.side);
      setThreshold(85);
      setMode("early-only");
      setJoinMin(kind === "watch" ? 2 : 1);
      setCount(3);
      setAmount("0.10");
      if (!name) setName("Demo");
      setDemoNote(`Picked: ${c.title}, at ${Math.round(c.chance * 100)}% now. Add your name and press the button.`);
      pendingDemo.current = c;
    } catch (e) {
      setDemoNote(e instanceof Error ? e.message : String(e));
    }
  }

  // Resolve the demo's contract index once the category's markets have loaded.
  useEffect(() => {
    if (!markets || !pendingDemo.current || picked?.idx !== -1) return;
    const m = markets.find((x) => x.ticker === pendingDemo.current!.eventTicker);
    const idx = m?.contracts.findIndex((c) => c.ticker === pendingDemo.current!.contractTicker) ?? -1;
    if (m && idx >= 0) {
      const ticker = m.ticker;
      Promise.resolve().then(() => setPicked({ ticker, idx }));
      pendingDemo.current = null;
    }
  }, [markets, picked]);

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-7">
        <section className="space-y-2">
          <h2 className="t-17 font-medium">Quick demo</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(
              [
                ["trigger", "Instant", "Already above 85%. Pays about a minute after joining closes."],
                ["watch", "Watch it cross", "Just below 85% now. Pays only if it rises; otherwise the money comes back."],
              ] as const
            ).map(([kind, title, sub]) => (
              <button
                key={kind}
                type="button"
                onClick={() => pickDemo(kind)}
                className="rounded-xl border px-4 py-3 text-left"
                style={kind === "trigger" ? { background: "var(--vg-accent)", color: "var(--vg-card)", borderColor: "var(--vg-accent)" } : { borderColor: "var(--vg-accent)" }}
              >
                <span className="t-15 block font-medium">{title}</span>
                <span className="t-13 block" style={{ opacity: 0.85 }}>
                  {sub}
                </span>
              </button>
            ))}
          </div>
          {demoNote && <p className="t-13">{demoNote}</p>}
        </section>

        <section className="space-y-3">
          <h2 className="t-17 font-medium">Pick an event</h2>
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
          {!markets && !error && <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>}
          {markets && markets.length === 0 && <p className="t-15">Nothing open here right now. Try another one.</p>}
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
              <legend className="t-15 font-medium">Pay when this gets likely</legend>
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
                How likely: <span className="mono">{threshold}%</span>
              </span>
              <input type="range" min={60} max={99} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 w-full" style={{ accentColor: "var(--vg-accent)" }} />
              <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                Now {pct(chance)}
              </span>
            </label>
            <TradeChart symbol={contract.instrument} side={side} threshold={threshold / 100} />
            <details>
              <summary className="t-15 cursor-pointer" style={{ color: "var(--vg-muted)" }}>More options</summary>
            <fieldset className="mt-3">
              <legend className="t-15 font-medium">If it never gets that likely</legend>
              <div className="mt-2 space-y-2">
                {(
                  [
                    ["early-only", "Give it back to me"],
                    ["early-or-outcome", "Pay anyway if it happens"],
                  ] as const
                ).map(([k, label]) => (
                  <label key={k} className="t-15 flex cursor-pointer items-center gap-2">
                    <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} style={{ accentColor: "var(--vg-accent)" }} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block">
              <span className="t-13" style={{ color: "var(--vg-muted)" }}>
                Minutes to join
              </span>
              <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} type="number" min={1} value={joinMin} onChange={(e) => setJoinMin(Math.max(1, Number(e.target.value) || 1))} />
            </label>
            </details>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Your name
            </span>
            <input className="t-15 mt-1 w-full rounded-lg border px-3 py-2.5" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbor Kayak Tours" />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              Each person gets ($)
            </span>
            <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
          <label className="block">
            <span className="t-13" style={{ color: "var(--vg-muted)" }}>
              How many people
            </span>
            <input className="mono t-15 mt-1 w-full rounded-lg border px-3 py-2.5 text-right" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-card)" }} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />
          </label>
        </section>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Fund market={market} contract={contract} side={side} threshold={threshold} mode={mode} name={name} amount={amount} count={count} joinMin={joinMin} demo={demo} />
      </aside>
    </div>
  );
}


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
      setBusy("One moment…");
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
      setBusy("Confirm in your wallet.");
      const m = prep.typedData.message;
      const signature = await adapter.signTypedData({
        domain: { ...prep.typedData.domain, chainId: Number(prep.typedData.domain.chainId) },
        types: prep.typedData.types,
        primaryType: prep.typedData.primaryType,
        message: { ...m, value: BigInt(m.value!), validAfter: BigInt(m.validAfter!), validBefore: BigInt(m.validBefore!) },
      } as unknown as TypedDataDefinition);
      setBusy("Almost done…");
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
        Put in ${((Number(p.amount) || 0) * p.count).toFixed(2)} and get the link
      </button>
      <p className="t-13 mt-2" style={{ color: "var(--vg-muted)" }}>
        {busy ?? (ready ? "No fees." : "Pick an event and add your name.")}
      </p>
      {err && <p className="t-13 mt-2" style={{ color: "var(--negative)" }}>{err}</p>}
    </section>
  );
}

function Share({ id }: { id: string; promise: string }) {
  const url = useMemo(() => (typeof window === "undefined" ? `/e/${id}` : `${window.location.origin}/e/${id}`), [id]);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, width: 180 }).then(setQr).catch(() => setQr(null));
  }, [url]);
  return (
    <section className="vg-ticket space-y-3 px-5 py-4">
      <h2 className="t-17 font-medium">Done. Share this link.</h2>
      <input readOnly value={url} onFocus={(e) => e.target.select()} className="mono t-13 w-full rounded-lg border px-3 py-2" style={{ borderColor: "var(--vg-rule)", background: "var(--vg-page)" }} aria-label="Share link" />
      {qr && <div className="w-[180px] rounded-lg bg-white p-1" aria-label="QR code for the share link" dangerouslySetInnerHTML={{ __html: qr }} />}
      <a href={`/e/${id}`} className="t-15 block underline underline-offset-4">
        Open it
      </a>
    </section>
  );
}
