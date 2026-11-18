"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { Address } from "viem";
import { closesIn, GeminiCredit, MarketList, midYes, type MarketItem } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { GeminiCard } from "@/components/cat/GeminiCard";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { useLivePrice } from "@/components/pot/usePrice";
import { Reliability } from "@/components/pot/Reliability";
import { AccountLine, btn, FundsHelp, SignIn, useActor } from "@/components/pot/Who";
import { Lives } from "@/components/perp/Lives";
import { marketLine, sidesOf } from "@/lib/marketName";
import { plainError } from "@/lib/messages";
import { prepareRope, YES, NO } from "@/lib/hc";
import { DEFAULT_LIVES, lifeFits, lifeWords, openPerp, perpLabel, perpSteps, points, ROPE_LIVES, stakeFor, times, treatOf } from "@/lib/perp";

const label: React.CSSProperties = { fontSize: 15, fontWeight: 600, color: C.ink };
const input: React.CSSProperties = { minHeight: 48, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 18, color: C.ink, width: "100%", boxSizing: "border-box" };
const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;
const $ = (base: bigint | number) => `$${(Number(base) / 1e6).toFixed(2)}`;
const MAX_BUDGET = 25_000_000n; // test version: at most $25 per player

const chip = (on: boolean): React.CSSProperties => ({
  ...btn,
  minHeight: 56,
  padding: "6px 14px",
  textAlign: "left",
  lineHeight: 1.25,
  background: on ? C.ink : "transparent",
  color: on ? C.page : C.ink,
  border: `1.5px solid ${C.ink}`,
});

/**
 * The perp form: market, side, leverage, stake per life, lives and rope life, then one plain
 * summary of what happens. Only ropes the contracts accept are offered.
 */
export function NewPerp({ perps }: { perps: Address }) {
  const router = useRouter();
  const who = useActor();
  const [market, setMarket] = useState<MarketItem | null>(null);
  const [side, setSide] = useState<0 | 1>(YES);
  const [lev, setLev] = useState<number | null>(null);
  const [stakeIn, setStakeIn] = useState("1");
  const [lives, setLives] = useState(String(DEFAULT_LIVES));
  const [life, setLife] = useState<number>(3600);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = useLivePrice(market?.symbol ?? null);
  const st = market ? sidesOf(market) : null;
  const p = live.smoothed ?? (market ? midYes(market) : null);
  const yesPpm = p === null ? null : Math.round(p * 1e6);
  const spread = market && market.bid != null && market.ask != null ? Math.round((market.ask - market.bid) * 1e6) : 50_000;
  const crypto = market?.category === "Crypto";
  const steps = useMemo(() => (yesPpm === null ? [] : perpSteps(side, yesPpm, { spread, crypto })), [side, yesPpm, spread, crypto]);
  // The chosen step, or the one nearest 3× when the choice no longer works at today's price.
  const rope = steps.find((r) => r.leverage === lev) ?? steps.reduce<(typeof steps)[number] | null>((best, r) => (!best || Math.abs(r.leverage - 3) < Math.abs(best.leverage - 3) ? r : best), null);
  const { size, stake } = rope ? stakeFor(rope.d, BigInt(Math.round((Number(stakeIn) || 0) * 1e6))) : { size: 0n, stake: 0n };
  const n = Math.max(0, Math.floor(Number(lives) || 0));
  const budget = stake * BigInt(n);
  const lifeOk = market ? ROPE_LIVES.filter((x) => lifeFits(x.s, market.closeMs)) : [];
  const ropeLife = lifeOk.find((x) => x.s === life)?.s ?? lifeOk.at(-1)?.s ?? null;
  const bad = !market
    ? "Pick a market."
    : yesPpm === null
      ? "Waiting for the price."
      : !rope
        ? "No rope works on this market at this price: the price is too close to 0 or 100, or the spread too wide. Pick another market."
        : size <= 0n
          ? "Put in a little more per life."
          : n < 1
            ? "At least one life."
            : budget > MAX_BUDGET
              ? `On the test version a perp's budget is at most ${$(MAX_BUDGET)}: fewer lives or a smaller stake.`
              : ropeLife === null
                ? "This market closes too soon for a perp (the first rope must end two hours before trading closes)."
                : null;

  async function submit() {
    if (!who.actor || !market || !rope || ropeLife === null) return;
    setErr(null);
    try {
      setStep("Reading the market's depth");
      // The depth attestation is for the perps contract: it opens every rope.
      const prep = await prepareRope(market.symbol, perps);
      if (size > BigInt(prep.maxSize)) throw new Error("This market is too thin for this stake right now. Put in less per life, or pick a busier market.");
      const r = await openPerp(who.actor, perps, prep, { side, d: rope.d, size, ropeLifeS: ropeLife, graceDays: 3, budget }, setStep);
      setStep("Done");
      router.push(r.perpId ? `/perps/${r.perpId}?new=1` : "/pots");
    } catch (e) {
      setErr(plainError(e));
      setStep(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>1. The question</h2>
        {market && st ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "baseline", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}`, padding: "14px 0" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, color: C.muted }}>{marketLine(market)}</span>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{st.yes}?</span>
              <GeminiLink slug={market.slug} label="See this market on Gemini" />
            </span>
            <span style={{ color: C.muted }}>
              {p === null ? "" : `${(p * 100).toFixed(1)}% chance now · `}trading closes in {closesIn(market.closeMs)}
            </span>
            <button type="button" onClick={() => setMarket(null)} style={{ background: "none", border: 0, textDecoration: "underline", cursor: "pointer", fontSize: 16, padding: 0, minHeight: 44 }}>
              Change
            </button>
          </div>
        ) : (
          <MarketList picked={null} onPick={setMarket} />
        )}
        {market && st && <GeminiCard slug={market.slug} question={`${st.yes}?`} yes={st.yesShort} no={st.noShort} price={p} />}
        {market ? <Reliability symbol={market.symbol} /> : <GeminiCredit />}
      </section>

      {market && st && (
        <section style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 720 }}>
          <h2 style={h2}>2. Your side, your leverage, your lives</h2>
          <div role="radiogroup" aria-label="Your side" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[YES, NO].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={side === s} onClick={() => setSide(s as 0 | 1)} style={{ ...chip(side === s), flex: "1 1 240px", minHeight: 64 }}>
                {s === YES ? st.yes : st.no}
                {p !== null && <span style={{ display: "block", fontSize: 15, fontWeight: 500 }}>{((s === YES ? p : 1 - p) * 100).toFixed(0)}% chance now</span>}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={label}>Leverage</span>
            {steps.length ? (
              <div role="radiogroup" aria-label="Leverage" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {steps.map((r) => (
                  <button key={r.leverage} type="button" role="radio" aria-checked={rope?.leverage === r.leverage} onClick={() => setLev(r.leverage)} style={chip(rope?.leverage === r.leverage)}>
                    {times(r.levMine)} for you
                    <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>
                      {times(r.levTheirs)} for them · rope {points(r.d)} points
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p style={{ margin: 0, color: C.muted }}>No leverage works at this price on this market.</p>
            )}
            <span style={{ fontSize: 14, color: C.muted }}>
              Higher leverage means shorter ropes: the posts are closer to the price, so a rope ends sooner. At most {crypto ? 10 : 5}× on this market.
            </span>
          </div>

          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
              <span style={label}>Stake per life (USDC)</span>
              <input style={input} inputMode="decimal" value={stakeIn} onChange={(e) => setStakeIn(e.target.value.replace(/[^0-9.]/g, ""))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 140px" }}>
              <span style={label}>Lives</span>
              <input style={input} inputMode="numeric" value={lives} onChange={(e) => setLives(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
              <span style={label}>Each rope lasts at most</span>
              <select style={input} value={ropeLife ?? ""} onChange={(e) => setLife(Number(e.target.value))}>
                {lifeOk.map((x) => (
                  <option key={x.s} value={x.s}>
                    {x.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {rope && stake > 0n && n > 0 && ropeLife !== null && p !== null && (
            <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 10, borderLeft: `3px solid ${C.ink}`, paddingLeft: 14 }}>
              <p style={{ margin: 0, fontSize: 20, lineHeight: 1.45 }}>
                Each rope, you and the other side each put in <strong>{$(stake)}</strong>. If the chance of “{st.yes}” reaches{" "}
                <strong>{points(side === YES ? rope.lower : rope.upper)}</strong>, you lose that {$(stake)} (one life); if it reaches{" "}
                <strong>{points(side === YES ? rope.upper : rope.lower)}</strong>, you win theirs. Otherwise the rope is divided at the price after {lifeWords(ropeLife)}, and the next one starts there.
              </p>
              <p style={{ margin: 0, fontSize: 17, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <Lives left={n} size={20} /> {n} {n === 1 ? "life" : "lives"}: {$(budget)} in all. Spare money stays yours: take it out whenever no rope needs it.
              </p>
              <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
                {perpLabel(rope.d, rope.levMine, rope.levTheirs)} (you first). The other side pays you a {$(treatOf(stake))} maker treat on the first rope. Nothing goes to HonorCat.
              </p>
            </div>
          )}
          <p role="note" style={{ margin: 0, fontSize: 16, lineHeight: 1.5, border: `2px solid ${C.signal}`, padding: "10px 14px" }}>
            <strong>A life can be lost in minutes.</strong> With {rope ? times(rope.levMine) : "leverage"}, a move of {rope ? points(rope.d) : "a few"} points ends the rope. On live games the price can jump that far
            at once. Only put in what you are happy to lose.
          </p>
        </section>
      )}

      {market && (
        <section style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 680 }}>
          <h2 style={h2}>3. Give your word</h2>
          {!who.actor ? (
            <SignIn who={who} purpose="Your account holds your lives. A passkey on this device is enough; HonorCat pays the network fees." />
          ) : (
            <>
              <AccountLine who={who} />
              <button type="button" style={{ ...btn, alignSelf: "flex-start", opacity: bad || step ? 0.6 : 1 }} disabled={!!bad || !!step} onClick={submit}>
                {step ?? `Give your word: ${n} ${n === 1 ? "life" : "lives"} for ${$(budget)}`}
              </button>
              {bad && <p style={{ margin: 0, color: C.muted }}>{bad}</p>}
            </>
          )}
          {err && (
            <p role="alert" style={{ margin: 0, color: C.signalInk, fontSize: 16 }}>
              {err}
            </p>
          )}
          {err?.startsWith("HonorCat's test money") && who.actor && <FundsHelp account={who.actor.account} />}
          <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Test version on Arc testnet: test money only. Not financial advice. Play within limits.</p>
        </section>
      )}
    </div>
  );
}
