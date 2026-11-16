"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { closesIn, GeminiCredit, MarketList, midYes, type MarketItem } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { useLivePrice } from "@/components/pot/usePrice";
import { Reliability } from "@/components/pot/Reliability";
import { marketLine, marketTitle, yesMeans } from "@/lib/marketName";
import { AccountLine, btn, SignIn, useActor } from "@/components/pot/Who";
import { getJson } from "@/lib/api";
import { createPot, MAX_TOLERANCE, NO, prepare, worstCase, YES } from "@/lib/hc";

const label: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: C.ink };
const input: React.CSSProperties = { minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 18, color: C.ink, width: "100%", boxSizing: "border-box" };
const MAX_N = 25;

export function NewPot() {
  const router = useRouter();
  const who = useActor();
  const [market, setMarket] = useState<MarketItem | null>(null);
  const [side, setSide] = useState<number>(YES);
  const [amount, setAmount] = useState("5");
  const [tolPts, setTolPts] = useState("2");
  const [grace, setGrace] = useState("3");
  const [practice, setPractice] = useState(false); // the practice cat takes the other side at once
  useEffect(() => {
    // /pots/new?practice=1 (the landing's "Try it alone") starts with practice on.
    if (new URLSearchParams(window.location.search).get("practice") === "1") void Promise.resolve().then(() => (setPractice(true), setAmount("1")));
  }, []);
  const [accept, setAccept] = useState(""); // the YES price (%) the creator accepts; empty = the current price
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = useLivePrice(market?.symbol ?? null);

  const p = live.smoothed ?? (market ? midYes(market) : null);
  const n = BigInt(Math.round((Number(amount) || 0) * 1e6));
  const tol = Math.round(Math.min(5, Math.max(0, Number(tolPts) || 0)) * 10_000);
  const own = accept.trim() === "" ? null : Number(accept);
  const center = own !== null && own > 0 && own < 100 ? Math.round(own * 10_000) : p === null ? null : Math.round(p * 1e6);
  const mine = center === null ? null : worstCase(side, n, center, tol);
  const theirs = center === null ? null : worstCase(1 - side, n, center, tol);
  const bad =
    !market ? "Pick a market." : n <= 0n ? "Enter an amount." : practice && n > 2_000_000n ? "The practice cat plays pots up to $2." : Number(amount) > MAX_N ? `Up to $${MAX_N} on the test version.` : Number(grace) < 1 ? "At least one day for settlement." : center === null ? "Waiting for the price." : null;

  async function submit() {
    if (!who.actor || !market || center === null) return;
    setErr(null);
    try {
      setStep("Reading the market's depth");
      const prep = await prepare(market.symbol, who.actor.account);
      if (BigInt(prep.cap) < n) throw new Error(`This market's order book allows pots up to $${(Number(prep.cap) / 1e6).toFixed(2)} right now (a quarter of a dollar per contract within 5 cents of the price).`);
      const bandCenter = own !== null ? center : (prep.midPpm ?? center);
      const r = await createPot(who.actor, prep, { side, notional: n, bandCenter, tolerance: Math.min(tol, MAX_TOLERANCE), graceDays: Number(grace) }, setStep);
      if (practice && r.potId) {
        setStep("The practice cat is taking the other side");
        await getJson(`/api/hc/practice`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ potId: r.potId }) });
      }
      setStep("Done");
      if (r.potId) router.push(`/pots/${r.potId}${practice ? "" : "?new=1"}`);
      else router.push(`/pots`);
    } catch (e) {
      setErr((e as Error).message);
      setStep(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Start a pot</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 680 }}>
          Pick a question on Gemini and a side. Someone takes the other side. While the market runs, each side&apos;s share of the pot follows the price, and either of you can leave at that share.
        </p>
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>
          Playing with a friend? <Link href="/pots/together">Start one together</Link>: you pick the question and the sides with them, and it is only for the two of you.
        </p>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>1. The question</h2>
        {market ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, padding: "14px 0" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, color: C.muted }}>{marketLine(market)}</span>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{marketTitle(market)}</span>
              <span style={{ fontSize: 15 }}>YES means: {yesMeans(market)}.</span>
            </span>
            <span style={{ color: C.muted }}>
              {p === null ? "" : `${(p * 100).toFixed(1)}% YES now · `}closes {closesIn(market.closeMs)}
            </span>
            <button type="button" onClick={() => setMarket(null)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 16, padding: 0 }}>
              Change
            </button>
          </div>
        ) : (
          <MarketList picked={null} onPick={setMarket} />
        )}
        {market ? <Reliability symbol={market.symbol} /> : <GeminiCredit />}
      </section>

      {market && (
        <section style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 680 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>2. Your side and the pot</h2>
          <div role="radiogroup" aria-label="Your side" style={{ display: "flex", gap: 12 }}>
            {[YES, NO].map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={side === s}
                onClick={() => setSide(s)}
                style={{ ...btn, flex: 1, background: side === s ? (s === YES ? C.ink : C.signal) : "transparent", color: side === s ? C.page : C.ink, border: `1.5px solid ${s === YES ? C.ink : C.signal}` }}
              >
                {s === YES ? `YES: ${market.label}` : `NO: not ${market.label}`}
              </button>
            ))}
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>Pot size in USDC (both sides together, up to ${MAX_N})</span>
            <input style={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={label}>The YES price you accept, in % (empty: today&apos;s {p === null ? "price" : `${(p * 100).toFixed(1)}%`})</span>
            <input style={input} inputMode="decimal" value={accept} placeholder={p === null ? "" : (p * 100).toFixed(1)} onChange={(e) => setAccept(e.target.value.replace(/[^0-9.]/g, ""))} />
            <span style={{ fontSize: 14, color: C.muted }}>Someone can join only while the market&apos;s 30-second average is within the band around this price.</span>
          </label>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
              <span style={label}>The price may move this far before someone joins (points, 0 to 5)</span>
              <input style={input} inputMode="decimal" value={tolPts} onChange={(e) => setTolPts(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 220 }}>
              <span style={label}>Days Gemini has to settle after the close (at least 1)</span>
              <input style={input} inputMode="numeric" value={grace} onChange={(e) => setGrace(e.target.value.replace(/[^0-9]/g, ""))} />
            </label>
          </div>
          {mine !== null && theirs !== null && (
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body }}>
              You put in <strong>${(Number(mine) / 1e6).toFixed(2)}</strong> now, the other side up to <strong>${(Number(theirs) / 1e6).toFixed(2)}</strong> when joining. The starting
              shares are set by the 30-second average price right after they join, and anything you put in above your share is returned at once. If the price leaves the{" "}
              {tolPts || 0}-point band first, the join does not happen and nobody pays anything. The exiting side pays a 1% fee to the other side.
            </p>
          )}
        </section>
      )}

      {market && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 680 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>3. Put it in</h2>
          {!who.actor ? (
            <SignIn who={who} purpose="Your account holds your side of the pot. A passkey on this device is enough; HonorCat pays the network fees." />
          ) : (
            <>
              <AccountLine who={who} />
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 16, lineHeight: 1.45, cursor: "pointer" }}>
                <input type="checkbox" checked={practice} onChange={(e) => (setPractice(e.target.checked), e.target.checked && Number(amount) > 2 && setAmount("2"))} style={{ width: 20, height: 20, marginTop: 2 }} />
                <span>
                  <strong>Practise alone:</strong> the practice cat (HonorCat&apos;s own test account) takes the other side right away, so you can watch the rope and leave
                  within two minutes. Up to $2, test money only.
                </span>
              </label>
              <button type="button" style={{ ...btn, alignSelf: "flex-start", opacity: bad || step ? 0.6 : 1 }} disabled={!!bad || !!step} onClick={submit}>
                {step ?? (practice ? "Start and play the practice cat" : "Start the pot")}
              </button>
              {bad && <p style={{ margin: 0, color: C.muted }}>{bad}</p>}
            </>
          )}
          {err && (
            <p role="alert" style={{ margin: 0, color: C.signalInk, fontSize: 16 }}>
              {err}
            </p>
          )}
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Test version on Arc testnet: test money only. Not financial advice. Play within limits.</p>
        </section>
      )}
    </div>
  );
}
