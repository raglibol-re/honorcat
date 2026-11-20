"use client";

import { money } from "@/lib/currency";

import Link from "next/link";
import { Button, ButtonLink } from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { More } from "@/components/ui/More";
import { Cat } from "@/components/cat/Cat";
import { CatName } from "@/components/cat/PlayerCat";
import { sidesOf } from "@/lib/statement";
import { nickname, useNames } from "@/lib/names";
import { HcFooterLinks, HcHeader } from "@/components/cat/Chrome";
import { GeminiCredit } from "@/components/cat/Markets";
import { CatHead, Ears, EyesLarge } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { sceneOf, STATE_TEXT } from "@/components/pot/scene";
import { useTechMode } from "@/components/TechMode";
import { marketTitle } from "@/lib/marketName";
import { useLivePrice } from "@/components/pot/usePrice";
import { usePolling } from "@/lib/api";
import { ropesStatus, type HcPot, type HcPotSummary } from "@/lib/hc";
import { KindTag, PerpRows } from "@/components/perp/PerpRows";
import type { PerpSummary } from "@/lib/perp";
import { useEffect, useState } from "react";
import { useNow } from "@/lib/useNow";
import type { HomeData } from "@/server/home";

const cond = { fontFamily: F.cond } as const;

function StartButton({
  inverted,
  href = "/pots/new",
  label = "Start a pot",
  note,
}: {
  inverted?: boolean;
  href?: string;
  label?: string;
  note?: string;
}) {
  return (
    <Link
      href={href}
      className="hc-btn"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 14,
        minHeight: 64,
        padding: "8px 28px 8px 22px",
        background: inverted ? C.page : C.ink,
        color: inverted ? C.ink : C.page,
        textDecoration: "none",
      }}
    >
      <CatHead
        width={34}
        height={32}
        fill={inverted ? C.ink : C.page}
        eyes={inverted ? C.page : C.ink}
      />
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          lineHeight: 1.15,
        }}
      >
        <span style={{ fontSize: 20, fontWeight: 600 }}>{label}</span>
        {note && (
          <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.8 }}>
            {note}
          </span>
        )}
      </span>
    </Link>
  );
}

/** The one live pot on the landing page (or, without one, an example rope on a live market). */
function LivePot({ data }: { data: HomeData }) {
  const { data: pot } = usePolling<HcPot>(
    data.potId ? `/api/hc/pots/${data.potId}` : null,
    4000,
  );
  const symbol = pot?.market?.instrument ?? data.market?.symbol ?? null;
  const live = useLivePrice(symbol);
  const nowS = Math.floor(useNow() / 1000);
  const { tech } = useTechMode();
  const names = useNames([pot?.owners.yes, pot?.owners.no, pot?.data.joiner]);
  if (data.potId && pot) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, fontSize: 17, color: C.muted }}>
          Live now: pot {pot.potId} on{" "}
          <strong style={{ color: C.ink }}>
            {pot.market ? marketTitle(pot.market) : "a Gemini market"}
          </strong>
          . {STATE_TEXT[pot.state]}{" "}
          <Link href={`/pots/${pot.potId}`}>Open it</Link>.{" "}
          {pot.market && <GeminiLink ticker={pot.market.eventTicker} slug={(pot.market as { slug?: string | null }).slug} label="See this market on Gemini" size={15} />}
        </p>
        <Rope
          {...sceneOf(pot, live.smoothed, nowS, { names, tech })}
          trail={live.trail}
          speed={live.speed}
        />
      </div>
    );
  }
  if (!data.market) return null;
  return <DemoGame market={data.market} live={live} />;
}

const DEMO_POT = 10;

/**
 * The start page's demo on a real Gemini market: pick a side, watch your share of a $10 example pot
 * move with Gemini's live price, then play the same market for real with test money.
 */
function DemoGame({ market, live }: { market: NonNullable<HomeData["market"]>; live: ReturnType<typeof useLivePrice> }) {
  const router = useRouter();
  const sides = sidesOf({ eventTitle: market.title, label: market.label, teams: market.teams, yesMeans: market.yesMeans });
  const [pick, setPick] = useState<0 | 1 | null>(null);
  const [entry, setEntry] = useState<number | null>(null);
  const p = live.smoothed;
  const worth = (side: 0 | 1, price: number) => Math.round((side === 0 ? price : 1 - price) * DEMO_POT * 100) / 100;
  const choose = (side: 0 | 1) => {
    setPick(side);
    setEntry(p);
  };
  const mine = pick !== null && p !== null ? worth(pick, p) : null;
  const change = pick !== null && p !== null && entry !== null ? Math.round((worth(pick, p) - worth(pick, entry)) * 100) / 100 : null;
  const play = () => {
    try {
      sessionStorage.setItem("hc:demo-market", JSON.stringify(market.item));
    } catch {
      /* private mode: the create page then starts with the market picker */
    }
    router.push(`/pots/new?from=demo&side=${pick ?? 0}`);
  };
  const sideBtn = (side: 0 | 1, label: string) => (
    <button type="button" className={`hc-btn hc-demo-side${pick === side ? " hc-btn--chosen" : " hc-btn--quiet"}`} aria-pressed={pick === side} onClick={() => choose(side)}>
      {label}
      {p !== null && <span className="hc-demo-side__price">{side === 0 ? Math.round(p * 100) : 100 - Math.round(p * 100)}%</span>}
    </button>
  );
  return (
    <div className="hc-demo">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 14px" }}>
        <span className="hc-live-pill">
          <span className="hc-live-dot" aria-hidden="true" /> Live on Gemini
        </span>
        <strong style={{ fontSize: 17 }}>{market.title}</strong>
        <GeminiLink ticker={market.eventTicker} slug={market.slug} label="See this market on Gemini" size={15} />
      </div>
      <p style={{ margin: 0, ...cond, fontSize: "clamp(26px, 4vw, 34px)", fontWeight: 600, lineHeight: 1.05 }}>
        {pick === null ? "Try it: which side do you take?" : "Your cat is on the rope. Watch it move."}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        {sideBtn(0, sides.yesShort)}
        {sideBtn(1, sides.noShort)}
      </div>
      <Rope
        price={p}
        notional={BigInt(DEMO_POT * 1_000_000)}
        names={pick === null ? { yes: "one player", no: "the other" } : { yes: pick === 0 ? "you" : "a friend", no: pick === 1 ? "you" : "a friend" }}
        sides={sides}
        phase="live"
        trail={live.trail}
        speed={live.speed}
      />
      <div className="hc-demo__result" aria-live="polite">
        {pick === null || mine === null ? (
          <span>An example {money(DEMO_POT * 1e6)} pot between you and a friend. Pick a side to see what your share is worth right now.</span>
        ) : (
          <span>
            Your side is worth <strong>{money(Math.round(mine * 1e6))}</strong> of the {money(DEMO_POT * 1e6)} pot right now
            {change !== null && change !== 0 && (
              <>
                {" "}
                (<strong style={{ color: change > 0 ? C.ink : C.signalInk }}>{change > 0 ? "+" : "−"}{money(Math.round(Math.abs(change) * 1e6))}</strong> since you picked)
              </>
            )}
            . Leave at any moment for that, less 1%, or hold to Gemini&apos;s result.
          </span>
        )}
        <Button onClick={play}>{pick === null ? "Play this market" : "Play this for real, with test money"}</Button>
      </div>
    </div>
  );
}

/** Pots waiting for someone to take the other side. */
function OpenOffers() {
  const { data } = usePolling<{ pots: HcPotSummary[] }>(
    "/api/hc/pots?state=open",
    15_000,
  );
  const now = useNow();
  const offers = (data?.pots ?? [])
    .filter((p) => Number(p.data.closeTime) * 1000 > now + 5 * 60_000)
    .slice(0, 5);
  const names = useNames(offers.map((p) => p.owners.yes ?? p.owners.no));
  // Open perps, once perps are switched on for everyone.
  const [perpsOn, setPerpsOn] = useState(false);
  useEffect(() => {
    ropesStatus()
      .then((r) => setPerpsOn(Boolean(r.perps && r.perpsForNewPots)))
      .catch(() => {});
  }, []);
  const perps = usePolling<{ perps: PerpSummary[] }>(
    perpsOn ? "/api/hc/perps?state=open" : null,
    15_000,
  );
  const perpOffers = (perps.data?.perps ?? []).slice(0, 3);
  if (!offers.length && !perpOffers.length) return null;
  return (
    <section
      className="hc-wrap"
      style={{
        paddingTop: 56,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600 }}>
        Waiting for someone
      </h2>
      {perpOffers.length > 0 && <PerpRows perps={perpOffers} offer />}
      <ul
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          borderTop: `1.5px solid ${C.ink}`,
        }}
      >
        {offers.map((p) => {
          const creatorYes = Number(p.data.creatorSide) === 0;
          const creator = p.owners.yes ?? p.owners.no;
          return (
            <li key={p.potId} style={{ borderBottom: `1px solid ${C.faint}` }}>
              <Link
                href={`/pots/${p.potId}`}
                className="hc-row"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 20px",
                  alignItems: "baseline",
                  padding: "14px 6px",
                  textDecoration: "none",
                  color: C.ink,
                }}
              >
                <span
                  style={{ fontSize: 18, fontWeight: 600, flex: "1 1 320px" }}
                >
                  <KindTag kind="Normal" />{" "}
                  {p.market ? marketTitle(p.market) : `Pot ${p.potId}`}
                </span>
                {creator && (
                  <span style={{ fontSize: 16 }}>
                    <CatName
                      account={creator}
                      name={
                        names[creator.toLowerCase()] ??
                        nickname(creator.toLowerCase())
                      }
                    />{" "}
                    waits
                  </span>
                )}
                <span style={{ fontSize: 16 }}>
                  {money(p.data.notional)} pot
                </span>
                <span style={{ fontSize: 16, color: C.muted }}>
                  {p.market
                    ? `take “${creatorYes ? sidesOf(p.market).no : sidesOf(p.market).yes}”`
                    : "take the other side"}{" "}
                  at about{" "}
                  {(
                    (creatorYes
                      ? 1_000_000 - Number(p.data.bandCenter)
                      : Number(p.data.bandCenter)) / 10_000
                  ).toFixed(0)}
                  % chance
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
    <div
      className="hc"
      style={{
        background: C.page,
        color: C.ink,
        fontFamily: F.sans,
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      <HcHeader />

      <section
        className="hc-wrap"
        style={{
          paddingTop: 36,
          display: "flex",
          flexDirection: "column",
          gap: 28,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 18,
            maxWidth: 1100,
          }}
        >
          <span
            style={{
              fontFamily: F.mono,
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.muted,
            }}
          >
            Play live Gemini markets with friends · on Arc
          </span>
          <h1
            style={{
              margin: 0,
              ...cond,
              fontSize: "clamp(54px, 8vw, 116px)",
              lineHeight: 0.9,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Take a side on a real question. Leave <span className="hc-mark">whenever</span> you like.
          </h1>
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "32px 72px",
            alignItems: "flex-start",
          }}
        >
          <div
            style={{
              flex: "1 1 380px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              paddingBottom: 8,
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: 21,
                lineHeight: 1.45,
                color: C.body,
                maxWidth: 520,
              }}
            >
              Two players share one pot on a Gemini question. The cat stands at
              the live price. Leave at that price any time, or hold to the
              result.
            </p>
            <ul
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 16,
                color: C.body,
              }}
            >
              {[
                "Each pot is a contract on Arc. No one holds your money.",
                "HonorCat takes no fee.",
              ].map((t) => (
                <li
                  key={t}
                  style={{ display: "flex", gap: 10, alignItems: "baseline" }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 8,
                      height: 8,
                      background: C.signal,
                      flex: "none",
                      transform: "translateY(-1px)",
                    }}
                  />
                  {t}
                </li>
              ))}
            </ul>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "12px 28px",
                alignItems: "center",
              }}
            >
              <StartButton
                href="/pots/new?practice=1"
                label="Try it now"
                note="Free test money, ready in two minutes"
              />
              <ButtonLink
                href="/pots/new"
                variant="quiet"
                style={{ minHeight: 64 }}
              >
                Start a real pot
              </ButtonLink>
            </div>
            <p style={{ margin: 0, fontSize: 17, color: C.body }}>
              Or <Link href="/pots">join a pot someone already opened</Link>.
            </p>
          </div>
          {/* On phones the live demo right below does the same job, so the worked example is left out. */}
          <div
            className="hc-home-example"
            style={{
              flex: "1 1 520px",
              display: "flex",
              flexDirection: "column",
              gap: 22,
              minWidth: 0,
            }}
          >
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: C.muted,
                marginTop: 4,
              }}
            >
              An example
            </span>
            <div
              aria-hidden="true"
              style={{ display: "flex", gap: 18, alignItems: "flex-end" }}
            >
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "flex-end",
                  gap: 6,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                <Cat
                  fur={{ hex: "#A8692E", label: "Brown tabby", light: false, pattern: "tabby" }}
                  pose="sit"
                  size={58}
                  mood="up"
                  label=""
                />{" "}
                Micky
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "flex-end",
                  gap: 6,
                  fontSize: 16,
                  fontWeight: 600,
                }}
              >
                <Cat
                  fur={{ hex: "#1A1A1A", label: "Black and white", light: false, pattern: "tuxedo" }}
                  pose="sit"
                  size={58}
                  mood="down"
                  label=""
                />{" "}
                Morty
              </span>
            </div>
            <ol
              aria-label="A worked example"
              style={{
                margin: 0,
                padding: 0,
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 2,
                fontSize: 18,
                lineHeight: 1.45,
              }}
            >
              {(
                [
                  [
                    "1",
                    "“Boston beats Orlando” is at 60%. Micky puts in $6, Morty $4. A $10 pot.",
                  ],
                  [
                    "2",
                    "The price moves to 75%. Micky’s share is now $7.50.",
                  ],
                  [
                    "3",
                    "Micky leaves with $7.40: the $7.50 less a 1% fee that goes to Morty. Or both hold, and the right side gets all $10.",
                  ],
                ] as const
              ).map(([n, t]) => (
                <li key={n} style={{ display: "flex", gap: 12 }}>
                  <span
                    style={{
                      ...cond,
                      fontWeight: 600,
                      color: C.signalInk,
                      flex: "none",
                      width: 14,
                    }}
                  >
                    {n}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="hc-wrap hc-home-demo" style={{ paddingTop: 48 }}>
        <LivePot data={data} />
      </section>

      <section
        className="hc-wrap"
        style={{
          paddingTop: 72,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <h2
          style={{
            margin: 0,
            ...cond,
            fontSize: 56,
            fontWeight: 600,
            lineHeight: 0.95,
          }}
        >
          Three ways to play
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
          {(
            [
              [
                "A pot",
                "One question, two sides. Leave or hold.",
                "/pots/new",
                "Start a pot",
                "rope",
              ],
              [
                "A perp",
                "A pot with leverage that renews every hour. You can never lose more than you put in.",
                "/perps",
                "See perps",
                "air",
              ],
              [
                "With a friend",
                "Choose the question and the amounts together, then send your friend the link.",
                "/pots/together",
                "Invite a friend",
                "second",
              ],
            ] as const
          ).map(([t, d, href, cta, pose]) => (
            <Link
              key={t}
              href={href}
              className="hc-play-card"
              style={{
                flex: "1 1 260px",
                padding: "18px 20px",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                color: C.ink,
                textDecoration: "none",
              }}
            >
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, minHeight: 64 }}>
                <h3 style={{ margin: 0, ...cond, fontSize: 32, fontWeight: 600 }}>{t}</h3>
                <span className="hc-play-card__cat" aria-hidden="true">
                  <Cat pose={pose} size={pose === "second" ? 92 : 72} label="" />
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 16,
                  lineHeight: 1.5,
                  color: C.body,
                  flex: 1,
                }}
              >
                {d}
              </p>
              <span className="hc-play-card__cta">{cta} →</span>
            </Link>
          ))}
        </div>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>
          Play fair to earn <Link href="/honor">Honor</Link>, points with no cash value.
        </p>
      </section>

      <OpenOffers />

      <section
        id="how"
        className="hc-wrap"
        style={{
          paddingTop: 56,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <More label="More about the rules" style={{ maxWidth: 760 }}>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: C.body }}>
            Starting shares come from the market price right after the second
            player joins.
          </p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: C.body }}>
            When you leave, three independent samplers measure the next 30
            seconds. You get your share at that price, minus a 1% fee to the
            other side. That is the $0.10 in the example.
          </p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: C.body }}>
            You can also set a <strong>net</strong>: you leave automatically if
            your side falls to a price you choose. A <strong>bowl</strong> is the
            same when it rises to one.{" "}
            <strong>Nine lives</strong> let you leave a ninth at a time. A{" "}
            <strong>handshake</strong> splits now with no fee. A{" "}
            <strong>takeover</strong> lets someone step into a leaving
            player&apos;s place.
          </p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: C.body }}>
            HonorCat takes no cut. Every fee goes to a player: the side that
            stays, the player who opened the pot, or the friend who invited
            you.
          </p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: C.body }}>
            Pots are capped at $25. Gemini prices can be off when few people trade a market. Not
            financial advice. Full rules are on each pot&apos;s{" "}
            <em>terms</em> page and in <Link href="/how">How it works</Link>.
          </p>
        </More>
        <GeminiCredit style={{ marginTop: 8 }} />
      </section>

      <div style={{ marginTop: 96 }}>
        <Ears
          viewBox="0 0 1440 120"
          points={["150,121 270,6 390,121", "1050,121 1170,6 1290,121"]}
        />
      </div>
      <footer style={{ background: C.ink, color: C.page }}>
        <div
          className="hc-wrap"
          style={{
            paddingTop: 40,
            paddingBottom: 40,
            display: "flex",
            flexDirection: "column",
            gap: 36,
          }}
        >
          <EyesLarge />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "28px 56px",
              alignItems: "flex-end",
              justifyContent: "space-between",
            }}
          >
            <p
              style={{
                margin: 0,
                ...cond,
                fontSize: "clamp(56px, 8vw, 120px)",
                fontWeight: 600,
                lineHeight: 0.92,
                maxWidth: 820,
                textWrap: "balance",
              }}
            >
              Honor among cats.
            </p>
            <StartButton inverted />
          </div>
          <HcFooterLinks />
        </div>
      </footer>
    </div>
  );
}
