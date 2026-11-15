"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CatScale } from "@/components/cat/CatScale";
import { PounceChart } from "@/components/cat/PounceChart";
import { RollingNumber } from "@/components/cat/RollingNumber";
import { HcFooterLinks, HcHeader } from "@/components/cat/Chrome";
import { CatHead, Ears, EyesLarge } from "@/components/cat/shapes";
import { StateRail, type RailStep } from "@/components/cat/StateRail";
import { C, F } from "@/components/cat/tokens";
import { getJson } from "@/lib/api";
import { formatDate, formatMoney, PAGE_LOCALE } from "@/lib/format";
import type { LandingData } from "@/server/landing";

const pct = (x: number) => `${Math.round(x * 100)}%`;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const dayAt = (ms: number) =>
  `${new Date(ms).toLocaleDateString(PAGE_LOCALE, { month: "short", day: "numeric" })} at ${new Date(ms).toLocaleTimeString(PAGE_LOCALE, { hour: "numeric", minute: "2-digit" })}`;

/** Polls the same data the server rendered, so the cat keeps sitting at the live chance. */
function useLanding(initial: LandingData | null) {
  const [d, setD] = useState<LandingData | null>(initial);
  useEffect(() => {
    let stop = false;
    const load = () =>
      getJson<LandingData>("/api/landing")
        .then((x) => !stop && setD(x))
        .catch(() => {});
    if (!initial) void load();
    const t = setInterval(load, 5_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [initial]);
  return d;
}

const cond = { fontFamily: F.cond } as const;

function CatButton({ inverted }: { inverted?: boolean }) {
  return (
    <Link
      href="/early/new"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        minHeight: 68,
        padding: "8px 28px 8px 22px",
        background: inverted ? C.page : C.ink,
        color: inverted ? C.ink : C.page,
        textDecoration: "none",
      }}
    >
      <CatHead width={34} height={32} fill={inverted ? C.ink : C.page} eyes={inverted ? C.page : C.ink} />
      <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>Let the cat out</span>
        <span style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.2, color: inverted ? C.muted : C.faint }}>Run the demo</span>
      </span>
    </Link>
  );
}

/** `initial` null: the frame renders at once (streaming fallback) and the data follows. */
export function Landing({ initial }: { initial: LandingData | null }) {
  const data = useLanding(initial);
  const loading = data === null;
  const hero = data?.hero ?? null;
  const payout = data?.payout ?? null;

  const what = hero ? (hero.side === "yes" ? `of “${hero.label}” (${hero.title})` : `that “${hero.label}” does not happen (${hero.title})`) : "";
  const gap = hero && hero.chance !== null ? Math.round((hero.threshold - hero.chance) * 100) : null;
  const catLine =
    hero && hero.chance !== null
      ? hero.chance >= hero.threshold
        ? "The cat is already past the bowl."
        : `The cat is ${gap} point${gap === 1 ? "" : "s"} from the bowl.`
      : "";

  const people = payout ? `${payout.paidPeople} ${payout.paidPeople === 1 ? "person was" : "people were"}` : "";
  const rec = payout?.record;
  const secs = (x: number) => (x < 90 ? `${x.toFixed(1)} seconds` : `${Math.round(x / 60)} minutes`);
  // Every value below is read from the featured payout's own records.
  const steps: RailStep[] = payout
    ? [
        { name: "Locked", done: true, phrase: `The cat sat on ${formatMoney(payout.lockedTotal)} in the vault`, mono: short(payout.vault) },
        {
          name: "Armed",
          done: true,
          phrase: `Ears up: ${payout.checks} independent ${payout.checks === 1 ? "check" : "checks"}, a sample every ${payout.intervalMs / 1000} seconds`,
        },
        { name: "Triggered", done: true, phrase: `Pounce: ${payout.triggerSigners} of 3 signers saw it hold above ${pct(payout.threshold)}` },
        {
          name: "Paid",
          done: true,
          phrase: `Everyone fed: ${formatMoney(payout.paidTotal)} to ${payout.paidPeople} ${payout.paidPeople === 1 ? "person" : "people"} in ${payout.paidTxs === 1 ? "one transaction" : `${payout.paidTxs} transactions`}${payout.settleSeconds !== null ? `, ${secs(payout.settleSeconds)} after the trigger` : ""}`,
        },
        {
          name: "Confirmed",
          done: !!rec,
          phrase: rec
            ? rec.status === "confirmed"
              ? "Purr: the event happened"
              : rec.status === "market_wrong"
                ? "Landed anyway: the market was wrong, the payout stands"
                : "The market was voided; the payout stands"
            : `Nap time until the result on ${dayAt(payout.tradingClose * 1000)}`,
        },
      ]
    : [];
  const last = payout?.series.at(-1);

  return (
    <div className="hc" style={{ background: C.page, color: C.ink, fontFamily: F.sans, minHeight: "100vh", boxSizing: "border-box" }}>
      <HcHeader />

      <section className="hc-wrap" style={{ paddingTop: 36, display: "flex", flexWrap: "wrap", gap: "32px 72px", alignItems: "flex-end" }}>
        <div key={hero ? `${hero.instrument}:${hero.side}:${hero.threshold}` : "none"} className="hc-swap" style={{ flex: "1 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }} aria-label={hero?.chance != null ? `${pct(hero.chance)} chance` : "chance unavailable"}>
            <span style={{ ...cond, fontWeight: 700, fontSize: "clamp(190px, 27vw, 400px)", lineHeight: 0.78, letterSpacing: "-0.02em" }}>
              <RollingNumber value={hero?.chance != null ? hero.chance * 100 : null} />
            </span>
            {/* The % flashes in the signal colour each time the chance moves. */}
            <span key={hero?.chance != null ? Math.round(hero.chance * 100) : -1} className="hc-tick" style={{ ...cond, fontWeight: 600, fontSize: "clamp(56px, 7vw, 104px)", lineHeight: 1 }}>
              %
            </span>
          </div>
          <p style={{ margin: "20px 0 0", fontSize: 19, lineHeight: 1.4, color: C.muted, maxWidth: 440 }}>
            {hero ? (
              <>
                is how sure a live Gemini market is {what}. {catLine}
                {hero.source === "pot" && hero.potId && (
                  <>
                    {" "}
                    <Link href={`/e/${hero.potId}`}>Watch this pot</Link>.
                  </>
                )}
              </>
            ) : loading ? (
              "Reading the market…"
            ) : (
              "Live market data is not available right now."
            )}
          </p>
        </div>
        <div style={{ flex: "1 1 420px", minWidth: 0, display: "flex", flexDirection: "column", gap: 22, paddingBottom: 6 }}>
          <h1 style={{ margin: 0, ...cond, fontSize: "clamp(52px, 6vw, 88px)", lineHeight: 0.96, fontWeight: 600, letterSpacing: "-0.005em", textWrap: "balance" }}>
            Get paid before it happens.
          </h1>
          <p style={{ margin: 0, fontSize: 21, lineHeight: 1.45, color: C.body, maxWidth: 520 }}>
            Cats know first. When a market says an event is very likely, everyone on the list gets the money. Automatically, with nothing to file.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", alignItems: "center" }}>
            <CatButton />
            <a href="#how" style={{ fontSize: 19, fontWeight: 500, padding: "14px 0" }}>
              How it works
            </a>
          </div>
        </div>
      </section>

      <section style={{ padding: "28px 0 0" }}>
        <div className="hc-wide">
          <CatScale chance={hero?.chance ?? null} threshold={hero?.threshold ?? 0.85} />
        </div>
        <div className="hc-narrow hc-wrap">
          <CatScale compact chance={hero?.chance ?? null} threshold={hero?.threshold ?? 0.85} />
        </div>
      </section>

      <section className="hc-wrap" style={{ paddingTop: 72, display: "flex", flexWrap: "wrap", gap: "28px 56px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
          <span style={{ fontSize: 15, color: C.muted }}>{payout ? `An earlier payout${payout.settledAt ? `, ${formatDate(new Date(payout.settledAt).getTime())}` : ""}` : ""}</span>
          <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
            {payout ? (payout.crossed ? "The moment it pounced" : "No crossing caught yet") : "No payout yet"}
          </h2>
          {payout && (
            <p style={{ margin: 0, fontSize: 19, lineHeight: 1.35, fontWeight: 600 }}>
              “{payout.side === "yes" ? payout.contractLabel : `not ${payout.contractLabel}`}”, {payout.eventTitle}
            </p>
          )}
          <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
            {payout
              ? payout.crossed
                ? `The line crossed ${pct(payout.threshold)} and held. ${people[0]!.toUpperCase()}${people.slice(1)} paid on the spot, before anyone knew the result.`
                : `No payout has crossed its line while we watched yet. In this one the chance was already above ${pct(payout.threshold)} from the first reading; ${people} paid once it held. Run “Watch it cross” to catch a crossing.`
              : loading
                ? "Loading the latest payout…"
                : "No early payout has happened yet. The first one will show here."}
          </p>
          {payout && <span style={{ fontFamily: F.mono, fontSize: 13, color: C.muted, overflowWrap: "anywhere" }}>Gemini · {payout.instrument}</span>}
        </div>
        {payout && (
          <div style={{ flex: "999 1 620px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ border: `1.5px solid ${C.ink}`, background: C.panel }}>
<div className="hc-wide">
              <PounceChart
                series={payout.series}
                threshold={payout.threshold}
                paidAt={payout.paidAt}
                endLabel={last ? `${pct(last.p)} last reading` : ""}
                ariaLabel={`The chance over time for “${payout.contractLabel}”. ${payout.crossed ? `It crosses the ${pct(payout.threshold)} line, where the payout fired` : `It stays above the ${pct(payout.threshold)} line; the payout fired once it held`}${last ? `, and ends at ${pct(last.p)}` : ""}.`}
              />
</div>
<div className="hc-narrow">
              <PounceChart
                width={500}
                series={payout.series}
                threshold={payout.threshold}
                paidAt={payout.paidAt}
                endLabel={last ? `${pct(last.p)} last reading` : ""}
                ariaLabel={`The chance over time for “${payout.contractLabel}”. ${payout.crossed ? `It crosses the ${pct(payout.threshold)} line, where the payout fired` : `It stays above the ${pct(payout.threshold)} line; the payout fired once it held`}${last ? `, and ends at ${pct(last.p)}` : ""}.`}
              />
</div>
            </div>
            <span style={{ fontSize: 14, color: C.muted }}>
              Real readings from this payout{payout.settledAt ? ` on ${formatDate(new Date(payout.settledAt).getTime())}` : ""}: the middle of Gemini’s best buy and sell
              price, as {payout.checks} independent {payout.checks === 1 ? "check" : "checks"} recorded it, averaged. <Link href={`/e/${payout.id}/proof`}>See the proof</Link>
            </span>
          </div>
        )}
      </section>

      {payout && (
        <section id="money" className="hc-wrap" style={{ paddingTop: 64 }}>
          <StateRail steps={steps} />
        </section>
      )}

      <section id="how" className="hc-wrap" style={{ paddingTop: 104, display: "flex", flexWrap: "wrap", gap: "24px 56px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, ...cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>How it works</h2>
          <p style={{ margin: 0, fontSize: 19, color: C.muted }}>Three steps. No hairballs.</p>
        </div>
        <ol style={{ flex: "999 1 620px", minWidth: 0, display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.ink}`, margin: 0, padding: 0, listStyle: "none" }}>
          {(
            [
              ["Fill the bowl", "Pick any live Gemini market and how likely the event must be, say 85%. Sign once. The money is held on Arc, where anyone can see it."],
              ["Call your people", "They open a link and join with a passkey. No wallet, no fees, nothing to fill in."],
              ["The cat pounces", "Three independent checks read the market every few seconds. When two of them see the chance hold above the line, everyone is paid at once."],
            ] as const
          ).map(([title, body], i) => (
            <li key={title} style={{ display: "flex", gap: 32, padding: "28px 0", borderTop: `1px solid ${C.ink}`, alignItems: "flex-start" }}>
              <span style={{ ...cond, fontSize: 84, fontWeight: 600, lineHeight: 0.85, flex: "0 0 56px" }}>{i + 1}</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{title}</h3>
                <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, color: C.body, maxWidth: 620 }}>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <div style={{ marginTop: 96 }}>
        <Ears viewBox="0 0 1440 120" points={["150,121 270,6 390,121", "1050,121 1170,6 1290,121"]} />
      </div>
      <footer style={{ background: C.ink, color: C.page }}>
        <div className="hc-wrap" style={{ paddingTop: 40, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 36 }}>
          <EyesLarge />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 56px", alignItems: "flex-end", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
              <p style={{ margin: 0, ...cond, fontSize: "clamp(56px, 8vw, 120px)", fontWeight: 600, lineHeight: 0.92, maxWidth: 820, textWrap: "balance" }}>Promises that always land.</p>
              <p style={{ margin: 0, fontSize: 21, lineHeight: 1.4, color: C.onInk }}>A cat always lands on its feet. So does your money.</p>
            </div>
            <CatButton inverted />
          </div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.faint, maxWidth: 720 }}>
            This is a testnet demo, not insurance. Chances come from Gemini market prices, which can be wrong. An early payout is final.
          </p>
          <HcFooterLinks />
        </div>
      </footer>
    </div>
  );
}
