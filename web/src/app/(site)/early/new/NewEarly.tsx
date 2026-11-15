"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { TypedDataDefinition } from "viem";
import { CatScale } from "@/components/cat/CatScale";
import { C, F } from "@/components/cat/tokens";
import { closesIn, GeminiCredit, MarketList, QualityMark, type MarketQuality } from "@/components/cat/Markets";
import { getJson, usePolling } from "@/lib/api";
import { formatAxis, parseUsdc } from "@/lib/format";
import { useWallet } from "@/lib/wallet/context";
import { PayFrom } from "@/components/cat/PayFrom";
import { CostView, RuleSummary } from "@/components/cat/CostView";

/** The contract a pot will watch. */
type Picked = { symbol: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string; category: string; closeMs: number };
type Quote = { mid: number | null; bid: number | null; ask: number | null; bidSize: number | null; askSize: number | null; quality: MarketQuality | null; at: number };
type Demo = { eventTicker: string; contractTicker: string; instrument: string; title: string; label: string; image: string | null; category: string; side: "yes" | "no"; chance: number; closesAt: string };

/** Under two hours to close: the demo rule; otherwise the standard rule (relay/src/catalog.ts). */
const profileOf = (closeMs: number, demo: boolean) => (demo || closeMs - Date.now() < 2 * 3600_000 ? "demo" : "standard");
const usableNow = (q: Quote | null) => q?.quality?.status === "works" || q?.quality?.status === "borderline";
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
const pct = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)}%`);

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 44, fontWeight: 600, lineHeight: 1 } as const;
const labelText = { fontSize: 15, color: C.muted } as const;
const field = {
  marginTop: 6,
  width: "100%",
  minHeight: 52,
  boxSizing: "border-box",
  border: `1.5px solid ${C.ink}`,
  background: C.panel,
  padding: "10px 14px",
  fontSize: 18,
  color: C.ink,
} as const;
const choice = (on: boolean) =>
  ({
    border: `1.5px solid ${C.ink}`,
    background: on ? C.ink : "transparent",
    color: on ? C.page : C.ink,
    cursor: "pointer",
  }) as const;

/** Recent trade prices with axes and the threshold, labelled as such (no bid/ask history exists). */
function TradeChart({ symbol, side, threshold }: { symbol: string | null; side: "yes" | "no"; threshold: number }) {
  const { data } = usePolling<{ points: { t: number; price: number }[] }>(symbol ? `/api/early/history?symbol=${symbol}&tf=5m` : null, 60_000);
  const pts = (data?.points ?? []).map((p) => ({ t: p.t, v: side === "yes" ? p.price : 1 - p.price }));
  if (symbol && !data) return <div style={{ height: 200, background: C.panel, border: `1.5px solid ${C.ink}` }} aria-hidden />;
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
  const grid: number[] = [];
  for (let g = Math.ceil(lo * 20) / 20; g <= hi; g += 0.05) grid.push(g);
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: "auto", display: "block", background: C.panel, border: `1.5px solid ${C.ink}` }}
        role="img"
        aria-label={`Recent trade prices, threshold ${Math.round(threshold * 100)}%`}
      >
        {grid.map((g) => (
          <line key={g} x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} stroke={C.grid} strokeWidth="1" />
        ))}
        <line x1={pad.l} x2={pad.l} y1={pad.t} y2={H - pad.b} stroke={C.ink} strokeWidth="1.5" />
        <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} stroke={C.ink} strokeWidth="1.5" />
        {yTicks.map((v) => (
          <text key={v} x={pad.l - 6} y={y(v / 100) + 6} textAnchor="end" fontSize={FS} style={{ fontFamily: F.cond }} fill={C.muted}>
            {v}%
          </text>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - 10} textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"} fontSize={FS} style={{ fontFamily: F.cond }} fill={C.muted}>
            {formatAxis(t, t1 - t0)}
          </text>
        ))}
        <line x1={pad.l} x2={W - pad.r} y1={y(threshold)} y2={y(threshold)} stroke={C.signal} strokeWidth="3" />
        <text x={pad.l - 6} y={y(threshold) + 6} textAnchor="end" fontSize={FS} fontWeight="600" style={{ fontFamily: F.sans }} fill={C.signalInk}>
          {Math.round(threshold * 100)}%
        </text>
        <path d={d} fill="none" stroke={C.ink} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption style={{ fontSize: 14, color: C.muted }}>
        Recent trade prices on Gemini, not the order book the checks read. Red line: your {Math.round(threshold * 100)}%. <GeminiCredit />
      </figcaption>
    </figure>
  );
}

export function NewEarly() {
  const [sel, setSel] = useState<Picked | null>(null);
  const { data: quote } = usePolling<Quote>(sel ? `/api/catalog/quote?symbol=${encodeURIComponent(sel.symbol)}` : null, 5000);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [threshold, setThreshold] = useState(85);
  const [mode, setMode] = useState<"early-only" | "early-or-outcome">("early-only");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [count, setCount] = useState(10);
  const [joinMin, setJoinMin] = useState(2);
  const [demoNote, setDemoNote] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);

  const live = quote && sel ? quote : null;
  const chance = live?.mid == null ? null : side === "yes" ? live.mid : 1 - live.mid;

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
      setSel({ symbol: c.instrument, eventTicker: c.eventTicker, contractTicker: c.contractTicker, eventTitle: c.title, label: c.label, category: c.category, closeMs: Date.parse(c.closesAt) });
      setDemo(true);
      setSide(c.side);
      setThreshold(85);
      setMode("early-only");
      setJoinMin(kind === "watch" ? 2 : 1);
      setCount(3);
      setAmount("0.10");
      if (!name) setName("Demo");
      setDemoNote(`Demo picked: ${c.title}, “${c.label}”, at ${Math.round(c.chance * 100)}% now. Add your name and press the button.`);
    } catch (e) {
      setDemoNote(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 560 }}>
        Pick a market and a line. When the chance holds above it, everyone on the link is paid.
      </p>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0" style={{ display: "flex", flexDirection: "column", gap: 44 }}>
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={h2}>Quick demo</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  style={{
                    textAlign: "left",
                    minHeight: 68,
                    padding: "12px 18px",
                    cursor: "pointer",
                    background: kind === "trigger" ? C.ink : "transparent",
                    color: kind === "trigger" ? C.page : C.ink,
                    border: `1.5px solid ${C.ink}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                  }}
                >
                  <span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>{title}</span>
                  <span style={{ fontSize: 15, lineHeight: 1.3, color: kind === "trigger" ? C.faint : C.muted }}>{sub}</span>
                </button>
              ))}
            </div>
            {demoNote && <p style={{ margin: 0, fontSize: 16, color: C.body }}>{demoNote}</p>}
          </section>

          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={h2}>Pick an event</h2>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.45, color: C.body, maxWidth: 620 }}>
              Any Gemini market works if its order book can pass the rule your pot gets. The ones that work right now come first.
            </p>
            <MarketList
              picked={sel?.symbol ?? null}
              onPick={(m) => {
                setSel({ symbol: m.symbol, eventTicker: m.eventTicker, contractTicker: m.contractTicker, eventTitle: m.eventTitle, label: m.label, category: m.category, closeMs: m.closeMs });
                setDemo(false);
                setDemoNote(null);
              }}
            />
          </section>

          {sel && (
            <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <h2 style={h2}>Set the line</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: `1.5px solid ${C.ink}`, borderBottom: `1px solid ${C.faint}`, padding: "12px 0" }}>
                <span style={{ fontSize: 14, color: C.muted }}>
                  {sel.category} · {sel.eventTitle} · closes in {closesIn(sel.closeMs)}
                  {demo ? " · demo" : ""}
                </span>
                <span style={{ fontSize: 19, fontWeight: 600 }}>{sel.label}</span>
                <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 14px", alignItems: "center", fontSize: 14, color: C.muted }}>
                  <QualityMark q={live?.quality ?? null} small />
                  {live?.quality && live.quality.reasons.length > 0 && <span>{live.quality.reasons.join("; ")}</span>}
                  {live && live.bid !== null && live.ask !== null && (
                    <span>
                      buy {Math.round(live.ask * 100)}¢, sell {Math.round(live.bid * 100)}¢, {Math.min(live.bidSize ?? 0, live.askSize ?? 0)} contracts at the best price
                    </span>
                  )}
                  <GeminiCredit />
                </span>
              </div>
              <fieldset style={{ border: 0, margin: 0, padding: 0 }}>
                <legend style={{ fontSize: 17, fontWeight: 600, padding: 0 }}>Pay when this gets likely</legend>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" style={{ marginTop: 10 }}>
                  {(["yes", "no"] as const).map((s) => (
                    <label key={s} style={{ ...choice(side === s), display: "flex", alignItems: "center", minHeight: 52, padding: "8px 14px", fontSize: 17 }}>
                      <input type="radio" name="side" className="sr-only" checked={side === s} onChange={() => setSide(s)} />
                      {s === "yes" ? `“${sel.label}” happens` : `“${sel.label}” does not happen`}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label style={{ display: "block" }}>
                <span style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 17, fontWeight: 600 }}>How likely</span>
                  <span style={{ fontFamily: F.cond, fontSize: 44, fontWeight: 700, lineHeight: 1, color: C.signalInk }}>{threshold}%</span>
                  <span style={{ fontSize: 15, color: C.muted }}>now {pct(chance)}</span>
                </span>
                <input
                  type="range"
                  min={60}
                  max={99}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ marginTop: 10, width: "100%", accentColor: C.signal }}
                />
              </label>
              <div style={{ maxWidth: 560 }}>
                <CatScale compact chance={chance} threshold={threshold / 100} />
              </div>
              <TradeChart symbol={sel.symbol} side={side} threshold={threshold / 100} />
              <details style={{ borderTop: `1px solid ${C.faint}`, borderBottom: `1px solid ${C.faint}`, padding: "12px 0" }}>
                <summary style={{ fontSize: 17, fontWeight: 600, cursor: "pointer" }}>More options</summary>
                <fieldset style={{ border: 0, margin: "14px 0 0", padding: 0 }}>
                  <legend style={{ fontSize: 17, fontWeight: 600, padding: 0 }}>If it never gets that likely</legend>
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {(
                      [
                        ["early-only", "Give it back to me"],
                        ["early-or-outcome", "Pay anyway if it happens"],
                      ] as const
                    ).map(([k, text]) => (
                      <label key={k} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 17, cursor: "pointer", minHeight: 36 }}>
                        <input type="radio" name="mode" checked={mode === k} onChange={() => setMode(k)} style={{ accentColor: C.signal, width: 18, height: 18 }} />
                        {text}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label style={{ display: "block", marginTop: 14, maxWidth: 240 }}>
                  <span style={labelText}>Minutes to join</span>
                  <input
                    style={{ ...field, fontFamily: F.mono, textAlign: "right" }}
                    type="number"
                    min={1}
                    value={joinMin}
                    onChange={(e) => setJoinMin(Math.max(1, Number(e.target.value) || 1))}
                  />
                </label>
              </details>
            </section>
          )}

          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={h2}>Call your people</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span style={labelText}>Your name</span>
                <input style={field} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Harbor Kayak Tours" />
              </label>
              <label className="block">
                <span style={labelText}>Each person gets ($)</span>
                <input style={{ ...field, fontFamily: F.mono, textAlign: "right" }} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block">
                <span style={labelText}>How many people</span>
                <input
                  style={{ ...field, fontFamily: F.mono, textAlign: "right" }}
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </label>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <Fund sel={sel} quote={live} side={side} threshold={threshold} mode={mode} name={name} amount={amount} count={count} joinMin={joinMin} demo={demo} />
        </aside>
      </div>
    </div>
  );
}

function Fund(p: { sel: Picked | null; quote: Quote | null; side: "yes" | "no"; threshold: number; mode: "early-only" | "early-or-outcome"; name: string; amount: string; count: number; joinMin: number; demo: boolean }) {
  const { connect, adapter } = useWallet();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; promise: string } | null>(null);
  // Whether the wallet already holds enough USDC on Arc (PayFrom reports it; null until known).
  const [onArc, setOnArc] = useState<boolean | null>(null);
  const ready = p.sel && usableNow(p.quote) && p.name.trim() && Number(p.amount) >= 0.01 && Number(p.amount) * p.count >= 0.1;

  async function fund() {
    if (!p.sel) return;
    setErr(null);
    try {
      setBusy("Connect your wallet…");
      const funder = await connect();
      if (!funder) throw new Error("Wallet not connected");
      setBusy("One moment…");
      const prep = await post<Prepared>("/api/early/prepare", {
        name: p.name.trim(),
        funder,
        eventTicker: p.sel.eventTicker,
        contractTicker: p.sel.contractTicker,
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
  const total = ((Number(p.amount) || 0) * p.count).toFixed(2);
  const off = !ready || busy !== null || onArc === false;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12, borderTop: `1.5px solid ${C.ink}`, paddingTop: 16 }}>
      <span style={{ fontSize: 15, color: C.muted }}>Into the bowl</span>
      <span style={{ fontFamily: F.cond, fontSize: 88, fontWeight: 700, lineHeight: 0.92, letterSpacing: "-0.01em" }}>${total}</span>
      {p.sel && <CostView total={Number(total)} chance={p.quote?.mid == null ? null : p.side === "yes" ? p.quote.mid : 1 - p.quote.mid} side={p.side} />}
      {p.sel && <RuleSummary profile={profileOf(p.sel.closeMs, p.demo)} threshold={p.threshold} />}
      <PayFrom need={parseUsdc(total)} onReady={setOnArc} />
      <button
        type="button"
        onClick={fund}
        disabled={off}
        style={{ width: "100%", minHeight: 52, background: C.ink, color: C.page, border: 0, fontSize: 18, fontWeight: 600, cursor: off ? "default" : "pointer", padding: "8px 16px", opacity: off ? 0.5 : 1 }}
      >
        Put in ${total} and get the link
      </button>
      <p style={{ margin: 0, fontSize: 15, color: C.muted }}>{busy ?? (p.sel && p.quote && !usableNow(p.quote) ? `This market does not meet its rule right now: ${p.quote.quality?.reasons.join("; ") ?? "no order book"}.` : !ready ? "Pick a market and add your name." : onArc === false ? "Not enough USDC on Arc yet: bring it from another chain above." : "No fees.")}</p>
      {err && <p style={{ margin: 0, fontSize: 15, color: C.signalInk }}>{err}</p>}
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
    <section style={{ display: "flex", flexDirection: "column" }}>
      <svg viewBox="0 0 342 30" style={{ width: "100%", height: "auto", display: "block" }} aria-hidden="true">
        <polygon points="22,31 54,2 86,31" fill={C.ink} />
        <polygon points="256,31 288,2 320,31" fill={C.ink} />
      </svg>
      <div style={{ background: C.ink, color: C.page, padding: "16px 20px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600, lineHeight: 1.05 }}>Done. Share this link.</h2>
        <input
          readOnly
          value={url}
          onFocus={(e) => e.target.select()}
          style={{ width: "100%", boxSizing: "border-box", fontFamily: F.mono, fontSize: 13, padding: "10px 12px", border: `1.5px solid ${C.page}`, background: C.ink, color: C.page }}
          aria-label="Share link"
        />
        {qr && <div style={{ width: 180, background: "#ffffff", padding: 4 }} aria-label="QR code for the share link" dangerouslySetInnerHTML={{ __html: qr }} />}
        <a
          href={`/e/${id}`}
          style={{ minHeight: 52, display: "inline-flex", alignItems: "center", justifyContent: "center", background: C.page, color: C.ink, fontSize: 18, fontWeight: 600, textDecoration: "none" }}
        >
          Open it
        </a>
      </div>
    </section>
  );
}
