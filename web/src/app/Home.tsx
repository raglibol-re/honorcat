"use client";

import Link from "next/link";
import { HcFooterLinks, HcHeader } from "@/components/cat/Chrome";
import { GeminiCredit } from "@/components/cat/Markets";
import { CatHead, Ears, EyesLarge } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { sceneOf, STATE_TEXT } from "@/components/pot/scene";
import { useTechMode } from "@/components/TechMode";
import { marketTitle } from "@/lib/marketName";
import { useNames } from "@/lib/names";
import { useLivePrice } from "@/components/pot/usePrice";
import { usePolling } from "@/lib/api";
import type { HcPot, HcPotSummary } from "@/lib/hc";
import { useNow } from "@/lib/useNow";
import type { HomeData } from "@/server/home";

const cond = { fontFamily: F.cond } as const;

function StartButton({ inverted }: { inverted?: boolean }) {
  return (
    <Link
      href="/pots/new"
      style={{ display: "inline-flex", alignItems: "center", gap: 14, minHeight: 64, padding: "8px 28px 8px 22px", background: inverted ? C.page : C.ink, color: inverted ? C.ink : C.page, textDecoration: "none" }}
    >
      <CatHead width={34} height={32} fill={inverted ? C.ink : C.page} eyes={inverted ? C.page : C.ink} />
      <span style={{ fontSize: 20, fontWeight: 600 }}>Start a pot</span>
    </Link>
  );
}

/** The one live pot on the landing page (or, without one, an example rope on a live market). */
function LivePot({ data }: { data: HomeData }) {
  const { data: pot } = usePolling<HcPot>(data.potId ? `/api/hc/pots/${data.potId}` : null, 4000);
  const symbol = pot?.market?.instrument ?? data.market?.symbol ?? null;
  const live = useLivePrice(symbol);
  const nowS = Math.floor(useNow() / 1000);
  const { tech } = useTechMode();
  const names = useNames([pot?.owners.yes, pot?.owners.no, pot?.data.joiner]);
  if (data.potId && pot) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 17, color: C.muted }}>
          Live now: pot {pot.potId} on <strong style={{ color: C.ink }}>{pot.market ? marketTitle(pot.market) : "a Gemini market"}</strong>. {STATE_TEXT[pot.state]}{" "}
          <Link href={`/pots/${pot.potId}`}>Open it</Link>.
        </p>
        <Rope {...sceneOf(pot, live.smoothed, nowS, { names, tech })} trail={live.trail} speed={live.speed} />
      </div>
    );
  }
  if (!data.market) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 17, color: C.muted }}>
        An example: a $10 pot on <strong style={{ color: C.ink }}>{`${data.market.title}: ${data.market.label}`}</strong>, moving with the live price.
      </p>
      <Rope price={live.smoothed} notional={10_000_000n} names={{ yes: "you", no: "a friend" }} phase="live" trail={live.trail} speed={live.speed} />
    </div>
  );
}

/** Pots waiting for someone to take the other side. */
function OpenOffers() {
  const { data } = usePolling<{ pots: HcPotSummary[] }>("/api/hc/pots?state=open", 15_000);
  const now = useNow();
  const offers = (data?.pots ?? []).filter((p) => Number(p.data.closeTime) * 1000 > now + 5 * 60_000).slice(0, 5);
  if (!offers.length) return null;
  return (
    <section className="hc-wrap" style={{ paddingTop: 56, display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600 }}>Waiting for someone</h2>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
        {offers.map((p) => {
          const creatorYes = Number(p.data.creatorSide) === 0;
          return (
            <li key={p.potId} style={{ borderBottom: `1px solid ${C.faint}` }}>
              <Link href={`/pots/${p.potId}`} className="hc-row" style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px", alignItems: "baseline", padding: "14px 6px", textDecoration: "none", color: C.ink }}>
                <span style={{ fontSize: 18, fontWeight: 600, flex: "1 1 320px" }}>{p.market ? `${p.market.eventTitle}: ${p.market.label}` : `Pot ${p.potId}`}</span>
                <span style={{ fontSize: 16 }}>${(Number(p.data.notional) / 1e6).toFixed(2)} pot</span>
                <span style={{ fontSize: 16, color: C.muted }}>
                  take {creatorYes ? "NO" : "YES"} near {(Number(p.data.bandCenter) / 10_000).toFixed(1)}% YES
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function Home({ data }: { data: HomeData }) {
  return (
    <div className="hc" style={{ background: C.page, color: C.ink, fontFamily: F.sans, minHeight: "100vh", boxSizing: "border-box" }}>
      <HcHeader />

      <section className="hc-wrap" style={{ paddingTop: 36, display: "flex", flexWrap: "wrap", gap: "24px 72px", alignItems: "flex-end" }}>
        <h1 style={{ margin: 0, ...cond, fontSize: "clamp(72px, 11vw, 168px)", lineHeight: 0.86, fontWeight: 600, letterSpacing: "-0.01em", flex: "1 1 520px" }}>Money in the air.</h1>
        <div style={{ flex: "1 1 380px", display: "flex", flexDirection: "column", gap: 20, paddingBottom: 8 }}>
          <p style={{ margin: 0, fontSize: 21, lineHeight: 1.45, color: C.body, maxWidth: 520 }}>
            Two people, one pot, one question on Gemini. While the market runs, each side&apos;s share follows the price, and either of you can step off the rope at that share.
          </p>
          <ol aria-label="A worked example" style={{ margin: 0, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 4, fontSize: 17, lineHeight: 1.45, color: C.ink, maxWidth: 560 }}>
            <li>Ana takes YES on &ldquo;Boston wins&rdquo; at 60%, Ben takes NO: a $10 pot, Ana puts in $6, Ben $4.</li>
            <li>Boston leads and the market moves to 75%: Ana&apos;s share is now $7.50, Ben&apos;s $2.50.</li>
            <li>Ana steps off and gets $7.40 (the $0.10 fee goes to Ben); or both hold and the side that was right gets all $10.</li>
          </ol>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px 28px", alignItems: "center" }}>
            <StartButton />
            <Link href="/pots/new?practice=1" style={{ fontSize: 19, fontWeight: 500, padding: "14px 0" }}>
              Try it alone
            </Link>
            <Link href="/pots/together" style={{ fontSize: 19, fontWeight: 500, padding: "14px 0" }}>
              Start one with a friend
            </Link>
            <Link href="/pots" style={{ fontSize: 19, fontWeight: 500, padding: "14px 0" }}>
              Take an open side
            </Link>
          </div>
        </div>
      </section>

      <section className="hc-wrap" style={{ paddingTop: 48 }}>
        <LivePot data={data} />
      </section>

      <OpenOffers />

      <section id="how" className="hc-wrap" style={{ paddingTop: 96, display: "flex", flexWrap: "wrap", gap: "24px 56px", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0, ...cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>How it works</h2>
          <p style={{ margin: 0, fontSize: 19, color: C.muted }}>
            The rules in full are on every pot&apos;s <em>terms</em> page.
          </p>
        </div>
        <ol style={{ flex: "999 1 620px", minWidth: 0, display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.ink}`, margin: 0, padding: 0, listStyle: "none" }}>
          {(
            [
              ["Pick a side", "Choose a live Gemini question and YES or NO. You put in your side's part of the pot; whoever takes the other side puts in theirs. The starting shares come from the market price measured right after they join."],
              ["Walk the rope", "The cat stands at the price. Left of it is YES's share, right of it NO's, in dollars. Shares are only shown; nothing moves until someone leaves or the market settles."],
              ["Step off or hold on", "Leave whenever you like: three independent samplers measure the 30 seconds after you ask, and you are paid your share at that price, minus a 1% fee to the other side. Or hold to the end and Gemini's result decides who gets the pot."],
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

      <section className="hc-wrap" style={{ paddingTop: 40 }}>
        <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body, maxWidth: 760 }}>
          Also on the rope: a <strong>net</strong> that catches your side if its price falls to a level, a <strong>bowl</strong> that takes your share off the rope when it rises to one, <strong>nine lives</strong> to leave a ninth at a
          time, a <strong>handshake</strong> to split now at the current price with no fee, and a <strong>takeover</strong>, where someone else steps into the leaving side&apos;s place.
        </p>
        <GeminiCredit style={{ marginTop: 16 }} />
      </section>

      <div style={{ marginTop: 96 }}>
        <Ears viewBox="0 0 1440 120" points={["150,121 270,6 390,121", "1050,121 1170,6 1290,121"]} />
      </div>
      <footer style={{ background: C.ink, color: C.page }}>
        <div className="hc-wrap" style={{ paddingTop: 40, paddingBottom: 40, display: "flex", flexDirection: "column", gap: 36 }}>
          <EyesLarge />
          <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 56px", alignItems: "flex-end", justifyContent: "space-between" }}>
            <p style={{ margin: 0, ...cond, fontSize: "clamp(56px, 8vw, 120px)", fontWeight: 600, lineHeight: 0.92, maxWidth: 820, textWrap: "balance" }}>A cat always lands on its feet.</p>
            <StartButton inverted />
          </div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.faint, maxWidth: 720 }}>
            A test version on Arc testnet with test money only. Not financial advice. Prices come from Gemini markets, which can be wrong or thin. Pots are capped at $25; play within limits.
          </p>
          <HcFooterLinks />
        </div>
      </footer>
    </div>
  );
}
