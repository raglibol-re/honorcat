"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  closesIn,
  MarketList,
  midYes,
  type MarketItem,
} from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { useLivePrice } from "@/components/pot/usePrice";
import { Reliability } from "@/components/pot/Reliability";
import { marketLine, sidesOf, yesMeans } from "@/lib/marketName";
import { AccountLine, FundsHelp, SignIn, useActor } from "@/components/pot/Who";
import { useTechMode } from "@/components/TechMode";
import { PlayerCat } from "@/components/cat/PlayerCat";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { GeminiCard } from "@/components/cat/GeminiCard";
import { FeeNote, useFees } from "@/components/pot/Receipts";
import { getJson } from "@/lib/api";
import { plainError } from "@/lib/messages";
import {
  createPot,
  createRope,
  MAX_TOLERANCE,
  NO,
  prepare,
  prepareRope,
  ROPE_BASE,
  ropesStatus,
  worstCase,
  YES,
  type HcPot,
  type RopesStatus,
} from "@/lib/hc";
import { NewPerp } from "@/components/perp/NewPerp";
import { ropeFor } from "@/lib/rope";
import { inviteMyAgent, seatsOf, type SeatView } from "@/lib/agent";

import { ActionProgress, Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Field";
import { money } from "@/lib/currency";
const label: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 600,
  color: C.ink,
};
const input: React.CSSProperties = {
  minHeight: 48,
  padding: "0 12px",
  border: `1.5px solid ${C.ink}`,
  background: C.page,
  fontFamily: F.sans,
  fontSize: 18,
  color: C.ink,
  width: "100%",
  boxSizing: "border-box",
};
const MAX_N = 25;
const PRACTICE_N = 2;
const $ = (base: bigint | number | string) => money(base);

export function NewPot() {
  const router = useRouter();
  const who = useActor();
  const { tech } = useTechMode();
  const [market, setMarket] = useState<MarketItem | null>(null);
  const [side, setSide] = useState<number>(YES);
  const [amount, setAmount] = useState("3"); // what this person puts in; the pot follows from the price
  const [tolPts, setTolPts] = useState("2");
  const [grace, setGrace] = useState("3");
  const [practice, setPractice] = useState(false); // the practice cat takes the other side at once
  useEffect(() => {
    // /pots/new?practice=1 (the landing's "Try it alone") starts with practice on.
    if (new URLSearchParams(window.location.search).get("practice") === "1")
      void Promise.resolve().then(() => (setPractice(true), setAmount("0.50")));
  }, []);
  const [accept, setAccept] = useState(""); // the chance (%) the creator accepts; empty = the current price
  // Who takes the other side of a practice pot: the practice cat, or the player's own Grok Bot.
  const [opponent, setOpponent] = useState<"cat" | "bot">("cat");
  const [seat, setSeat] = useState<SeatView | null>(null);
  const account = who.actor?.account ?? null;
  useEffect(() => {
    if (!account) return;
    let alive = true;
    seatsOf(account)
      .then((r) => alive && setSeat(r.seats.find((s) => s.active) ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account]);
  // HonorCat v2 (short ropes): only once deployed and switched on for new pots.
  const [ropes, setRopes] = useState<RopesStatus | null>(null);
  useEffect(() => {
    ropesStatus()
      .then(setRopes)
      .catch(() => {});
  }, []);
  // Two offers: a normal pot, or a perp (a chain of short ropes with lives). ?kind=perp opens the perp
  // form; ?perps=preview shows it before perps are switched on for everyone (testing).
  const [kind, setKind] = useState<"normal" | "perp">("normal");
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    void Promise.resolve().then(() => {
      if (q.get("kind") === "perp") setKind("perp");
      if (q.get("perps") === "preview") setPreview(true);
    });
  }, []);
  // A copy link (/pots/new?copy=<token>&side=<0|1>): the same market and side as another player's pot.
  const [copy, setCopy] = useState<{
    token: bigint;
    leader: string;
    potId: string;
  } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const t = q.get("copy");
    if (!t || !/^\d+$/.test(t)) return;
    const token = BigInt(t);
    // the leader's pot (database id) comes with the link; older links had only the token (v2.0 range)
    const potId =
      q.get("pot") && /^\d+$/.test(q.get("pot")!)
        ? q.get("pot")!
        : (ROPE_BASE + token / 2n).toString();
    void (async () => {
      const lead = await getJson<HcPot>(`/api/hc/pots/${potId}`).catch(
        () => null,
      );
      if (!lead?.market) return;
      const s = Number(token % 2n);
      const leader = (s === 0 ? lead.owners.yes : lead.owners.no) ?? "";
      const quote = await getJson<{ bid: number | null; ask: number | null }>(
        `/api/catalog/quote?symbol=${encodeURIComponent(lead.market.instrument)}`,
      ).catch(() => null);
      const m = lead.market as unknown as Record<string, unknown>;
      setSide(s);
      setCopy({ token, leader, potId });
      setMarket({
        symbol: lead.market.instrument,
        eventTicker: lead.market.eventTicker,
        contractTicker: String(m.contractTicker ?? ""),
        category:
          /^GEMI-(BTC|ETH|SOL|XRP|DOGE|HYPE|ZEC|LTC|AVAX|LINK|ADA|BNB|SUI)/i.test(
            lead.market.instrument,
          )
            ? "Crypto"
            : "Other",
        subcategory: null,
        eventTitle: lead.market.eventTitle,
        slug: (m.slug as string | null) ?? null,
        label: lead.market.label,
        closeMs:
          Number(
            m.closeMs ??
              (lead.data as unknown as { closeTime: string }).closeTime,
          ) * (m.closeMs ? 1 : 1000),
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        eventVolume24h: null,
        image: null,
        teams: (m.teams as string | null) ?? null,
        startMs: (m.startMs as number | null) ?? null,
        yesMeans: (m.yesMeans as string | null) ?? null,
        book: null,
        quality: { status: "works" } as MarketItem["quality"],
      });
    })();
  }, []);
  // New pots are v2 once switched on, practice pots too (the practice cat joins them like a player);
  // only a Grok Bot opponent still needs a v1 pot.
  const v2 = Boolean(ropes?.forNewPots) && !(practice && opponent === "bot");
  const perpsOn = Boolean(ropes?.perps && (ropes.perpsForNewPots || preview));
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const live = useLivePrice(market?.symbol ?? null);
  const fees = useFees();
  const st = market ? sidesOf(market) : null;

  const p = live.smoothed ?? (market ? midYes(market) : null);
  const tol = Math.round(
    Math.min(5, Math.max(0, Number(tolPts) || 0)) * 10_000,
  );
  const own = accept.trim() === "" ? null : Number(accept);
  const center =
    own !== null && own > 0 && own < 100
      ? Math.round(own * 10_000)
      : p === null
        ? null
        : Math.round(p * 1e6);
  // The person enters their own part; the pot is that part divided by their side's chance.
  const mineIn = Math.round((Number(amount) || 0) * 1e6);
  const sideChance =
    center === null ? null : side === YES ? center / 1e6 : 1 - center / 1e6;
  const n =
    sideChance === null || sideChance <= 0
      ? 0n
      : BigInt(Math.round(mineIn / sideChance / 10_000) * 10_000);
  const theirsIn = n > BigInt(mineIn) ? n - BigInt(mineIn) : 0n;
  const mine = center === null ? null : worstCase(side, n, center, tol);
  const cap = practice ? PRACTICE_N : MAX_N;
  const bad = !market
    ? "Pick a market."
    : mineIn <= 0
      ? "Enter what you put in."
      : own !== null && !(own > 0 && own < 100)
        ? "The chance you accept must be between 0 and 100."
        : Number(tolPts) > 5
          ? "The band is at most 5 points either way."
          : center === null
        ? "Waiting for the price."
        : sideChance !== null && (sideChance < 0.02 || sideChance > 0.98)
          ? "This side is almost certain either way; pick a closer market."
          : Number(n) / 1e6 > cap
            ? practice
              ? `The practice cat plays pots up to ${$(PRACTICE_N * 1_000_000)}: put in at most ${$(Math.floor(PRACTICE_N * 1e6 * sideChance!))}.`
              : `Pots go up to ${$(MAX_N * 1_000_000)} on the test version: put in at most ${$(Math.floor(MAX_N * 1e6 * sideChance!))}.`
            : Number(grace) < 1
              ? "Gemini needs at least one day to settle."
              : null;

  async function submit() {
    if (!who.actor || !market || center === null) return;
    setErr(null);
    try {
      if (practice && opponent === "cat") {
        setStep("Checking the practice cat");
        const ps = await getJson<{ available: boolean; reason: string | null }>(
          `/api/hc/practice`,
        );
        if (!ps.available)
          throw new Error(
            ps.reason ?? "The practice cat cannot play right now.",
          );
      }
      if (v2) {
        setStep("Reading the market's depth");
        const prepV2 = await prepareRope(market.symbol, who.actor.account);
        const bandCenterV2 = own !== null ? center : (prepV2.midPpm ?? center);
        // A normal pot (no posts): leverage belongs to perps.
        const c = ropeFor(
          side === YES ? 0 : 1,
          bandCenterV2,
          BigInt(mineIn),
          1,
        );
        if (c.size <= 0n)
          throw new Error(
            "Put in a little more: this is less than one hundredth of a contract.",
          );
        if (c.size > BigInt(prepV2.maxSize))
          throw new Error(
            `This market is too thin for this rope right now. Put in less, or pick a busier market.`,
          );
        const tolV2 = Math.min(tol, MAX_TOLERANCE);
        const perContract = BigInt(
          Math.floor(
            (side === YES
              ? Math.min(1_000_000, bandCenterV2 + tolV2)
              : 1_000_000 - Math.max(0, bandCenterV2 - tolV2)) / 100,
          ),
        );
        const r = await createRope(
          who.actor,
          prepV2,
          {
            side,
            size: c.size,
            bandCenter: bandCenterV2,
            tolerance: tolV2,
            distYes: 0,
            distNo: 0,
            expiry: 0,
            graceDays: Number(grace),
            escrow: perContract * c.size,
            copyOf: copy && Number(copy.token % 2n) === side ? copy.token : 0n,
          },
          setStep,
        );
        if (practice && r.potId) {
          setStep("The practice cat is taking the other side");
          try {
            await getJson(`/api/hc/practice`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ potId: r.potId }),
            });
          } catch {
            // The pot exists; it now waits for a real opponent and can be cancelled on its page.
            router.push(`/pots/${r.potId}?practice=failed`);
            return;
          }
          setStep("Done");
          router.push(`/pots/${r.potId}`);
          return;
        }
        setStep("Done");
        router.push(r.potId ? `/pots/${r.potId}?new=1` : `/pots`);
        return;
      }
      setStep("Reading the market's depth");
      const prep = await prepare(market.symbol, who.actor.account);
      if (BigInt(prep.cap) < n)
        throw new Error(
          `This market is too thin for a ${$(n)} pot right now; it allows up to ${$(BigInt(prep.cap))}. Put in less, or pick a busier market.`,
        );
      const bandCenter = own !== null ? center : (prep.midPpm ?? center);
      const r = await createPot(
        who.actor,
        prep,
        {
          side,
          notional: n,
          bandCenter,
          tolerance: Math.min(tol, MAX_TOLERANCE),
          graceDays: Number(grace),
        },
        setStep,
      );
      if (practice && opponent === "bot" && r.potId) {
        setStep("Inviting your Grok Bot");
        // The pot exists and is paid for: whatever happens to the invite, go to it (never back to
        // this form, where pressing again would open and pay for a second pot).
        const ok = await inviteMyAgent(r.potId).then(() => true, () => false);
        router.push(`/pots/${r.potId}?bot=${ok ? "1" : "failed"}`);
        return;
      }
      if (practice && r.potId) {
        setStep("The practice cat is taking the other side");
        try {
          await getJson(`/api/hc/practice`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ potId: r.potId }),
          });
        } catch {
          // The pot exists; it now waits for a real opponent and can be taken back on its page.
          router.push(`/pots/${r.potId}?practice=failed`);
          return;
        }
      }
      setStep("Done");
      if (r.potId) router.push(`/pots/${r.potId}${practice ? "" : "?new=1"}`);
      else router.push(`/pots`);
    } catch (e) {
      setErr(plainError(e));
      setStep(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1
          style={{
            margin: 0,
            fontFamily: F.cond,
            fontSize: "clamp(44px, 9vw, 64px)",
            fontWeight: 600,
            lineHeight: 0.95,
          }}
        >
          {kind === "perp" ? "Start a perp" : "Start a pot"}
        </h1>
        <div
          role="radiogroup"
          aria-label="What to start"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", maxWidth: 760 }}
        >
          {(
            [
              {
                k: "normal",
                title: "Normal",
                line: "One pot until the market closes. Your share follows the price; leave whenever you like.",
              },
              {
                k: "perp",
                title: "Perp",
                line: "Leverage on the price: a chain of short ropes. You pick the leverage and how many lives you bring.",
              },
            ] as const
          ).map((o) => {
            const on = kind === o.k;
            const off = o.k === "perp" && !perpsOn;
            return (
              <button
                key={o.k}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={off}
                onClick={() => (
                  setKind(o.k),
                  o.k === "perp" && setPractice(false)
                )}
                className="hc-choice"
                style={{
                  flex: "1 1 260px",
                  padding: "14px 16px",
                  minHeight: 96,
                  gap: 6,
                  borderWidth: 2,
                  fontWeight: 400,
                }}
              >
                <strong
                  style={{
                    fontFamily: F.cond,
                    fontSize: 30,
                    fontWeight: 600,
                    lineHeight: 1,
                  }}
                >
                  {o.title}
                </strong>
                <span style={{ fontSize: 16, lineHeight: 1.4 }}>
                  {off ? "Coming soon: perps are being tested on Arc." : o.line}
                </span>
              </button>
            );
          })}
        </div>
        {kind === "perp" && preview && !ropes?.perpsForNewPots && (
          <p
            role="note"
            style={{ margin: 0, fontSize: 15, color: C.signalInk }}
          >
            Preview: perps are not switched on for everyone yet.
          </p>
        )}
        {kind === "normal" && (
          <p
            style={{
              margin: 0,
              fontSize: 19,
              lineHeight: 1.45,
              color: C.body,
              maxWidth: 680,
            }}
          >
            Pick a question on Gemini and a side. Someone takes the other side.
            While the market runs, each side&apos;s share of the pot follows the
            price, and either of you can leave at that share.
          </p>
        )}
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>
          Playing with a friend?{" "}
          <Link href="/pots/together">Start one together</Link>: you pick the
          question and the sides with them, and it is only for the two of you.
        </p>
        {practice && (
          <div
            role="note"
            style={{
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
              flexWrap: "wrap",
              border: `2px solid ${C.ink}`,
              padding: "14px 16px",
              maxWidth: 760,
            }}
          >
            <PlayerCat
              fur="grey"
              pose="sit"
              size={90}
              label="The practice cat, waiting at its post"
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                flex: "1 1 320px",
              }}
            >
              <strong
                style={{
                  fontFamily: F.cond,
                  fontSize: 28,
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                Practice: you play against the practice cat
              </strong>
              <span style={{ fontSize: 16, lineHeight: 1.5 }}>
                The practice cat is HonorCat&apos;s own test account. It plays
                with test money only, and practice pots never count in your
                honor record.
              </span>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 22,
                  fontSize: 16,
                  lineHeight: 1.55,
                  listStyle: "decimal",
                }}
              >
                <li>Pick a question and your side.</li>
                <li>
                  Put in up to{" "}
                  {$(Math.floor(PRACTICE_N * 1e6 * (sideChance ?? 0.5)))} (the
                  pot is at most ${PRACTICE_N}); new players get test money
                  automatically.
                </li>
                <li>
                  Give your word: the practice cat takes the other side at once
                  and the rope starts moving.
                </li>
                <li>
                  Leave whenever you like: your exit is priced over the next 30
                  seconds and paid out in about a minute.
                </li>
              </ol>
              <span style={{ fontSize: 14, color: C.muted }}>
                Want a real opponent instead? Untick “Practise alone” in step 3.
              </span>
            </div>
          </div>
        )}
      </header>
      {kind === "perp" && perpsOn && ropes?.perps ? <NewPerp perps={ropes.perps} /> : null}

      {kind === "normal" && (
        <>
          <section
            style={{ display: "flex", flexDirection: "column", gap: 12 }}
          >
            <h2
              style={{
                margin: 0,
                fontFamily: F.cond,
                fontSize: 32,
                fontWeight: 600,
              }}
            >
              1. The question
            </h2>
            {market && st ? (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 16,
                  alignItems: "baseline",
                  borderTop: `1.5px solid ${C.ink}`,
                  borderBottom: `1.5px solid ${C.ink}`,
                  padding: "14px 0",
                }}
              >
                <span
                  style={{ display: "flex", flexDirection: "column", gap: 2 }}
                >
                  <span style={{ fontSize: 14, color: C.muted }}>
                    {marketLine(market)}
                  </span>
                  <span style={{ fontSize: 20, fontWeight: 600 }}>
                    {st.yes}?
                  </span>
                  <GeminiLink
                    ticker={market.eventTicker}
                    slug={market.slug}
                    label="See this market on Gemini"
                  />
                  {tech && (
                    <span style={{ fontSize: 14, color: C.muted }}>
                      Technical: YES on {market.symbol} settles YES if{" "}
                      {yesMeans(market).charAt(0).toLowerCase() +
                        yesMeans(market).slice(1)}
                      .
                    </span>
                  )}
                </span>
                <span style={{ color: C.muted }}>
                  {p === null ? "" : `${(p * 100).toFixed(1)}% chance now · `}
                  trading closes in {closesIn(market.closeMs)}
                </span>
                <button
                  type="button"
                  onClick={() => setMarket(null)}
                  style={{
                    background: "none",
                    border: 0,
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontSize: 16,
                    padding: 0,
                    minHeight: 44,
                  }}
                >
                  Change
                </button>
              </div>
            ) : (
              <MarketList picked={null} onPick={setMarket} />
            )}
            {market && st && (
              <GeminiCard
                ticker={market.eventTicker}
                slug={market.slug}
                question={`${st.yes}?`}
                yes={st.yesShort}
                no={st.noShort}
                price={p}
              />
            )}
            {market && <Reliability symbol={market.symbol} />}
          </section>

          {market && st && (
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 20,
                maxWidth: 680,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontFamily: F.cond,
                  fontSize: 32,
                  fontWeight: 600,
                }}
              >
                2. Your side and your part
              </h2>
              <div
                role="radiogroup"
                aria-label="Your side"
                style={{ display: "flex", gap: 12, flexWrap: "wrap" }}
              >
                {[YES, NO].map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={side === s}
                    onClick={() => setSide(s)}
                    className={
                      s === YES ? "hc-choice" : "hc-choice hc-choice--signal"
                    }
                    style={{
                      flex: "1 1 240px",
                      minHeight: 64,
                      ...(s === YES ? {} : { borderColor: C.signal }),
                    }}
                  >
                    {s === YES ? st.yes : st.no}
                    {p !== null && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 15,
                          fontWeight: 500,
                        }}
                      >
                        {((s === YES ? p : 1 - p) * 100).toFixed(0)}% chance now
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <label
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <span style={label}>What you put in (USDC)</span>
                <input
                  style={input}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) =>
                    setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                  }
                />
              </label>
              {n > 0n && center !== null && (
                <div
                  aria-live="polite"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    borderLeft: `3px solid ${C.ink}`,
                    paddingLeft: 14,
                  }}
                >
                  <p style={{ margin: 0, fontSize: 21, lineHeight: 1.4 }}>
                    Your opponent puts in <strong>{$(theirsIn)}</strong>. The
                    pot is <strong>{$(n)}</strong>.
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 16,
                      lineHeight: 1.5,
                      color: C.body,
                    }}
                  >
                    The favourite costs more: each side puts in its chance times
                    the pot, so nobody starts ahead.
                  </p>
                </div>
              )}
              {v2 && copy && (
                <p
                  role="note"
                  style={{
                    margin: 0,
                    fontSize: 16,
                    lineHeight: 1.5,
                    border: `2px solid ${C.ink}`,
                    padding: "10px 14px",
                  }}
                >
                  <strong>Copycat pot:</strong> you copy the{" "}
                  {Number(copy.token % 2n) === YES ? "YES" : "NO"} side of{" "}
                  <Link href={`/pots/${copy.potId}`}>pot {copy.potId}</Link>. If
                  you end with a profit, 5% of that profit goes to that player;
                  if you do not, nothing does.
                  {Number(copy.token % 2n) !== side &&
                    " (You picked the other side, so this pot is not a copy.)"}
                </p>
              )}
              {v2 && (
                <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
                  Nothing goes to HonorCat: every fee goes to a player.
                </p>
              )}
              <details>
                <summary
                  style={{ cursor: "pointer", fontSize: 16, minHeight: 32 }}
                >
                  More options
                </summary>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                    paddingTop: 12,
                  }}
                >
                  <label
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    <span style={label}>
                      The chance you accept for “{st.yes}”, in % (empty:
                      today&apos;s{" "}
                      {p === null ? "price" : `${(p * 100).toFixed(1)}%`})
                    </span>
                    <input
                      style={input}
                      inputMode="decimal"
                      value={accept}
                      placeholder={p === null ? "" : (p * 100).toFixed(1)}
                      onChange={(e) =>
                        setAccept(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                    />
                    <span style={{ fontSize: 14, color: C.muted }}>
                      Someone can join only while the market&apos;s 30-second
                      average stays close to this price (see the next setting).
                    </span>
                  </label>
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        flex: 1,
                        minWidth: 220,
                      }}
                    >
                      <span style={label}>
                        The price may move this far before someone joins
                        (points, 0 to 5)
                      </span>
                      <input
                        style={input}
                        inputMode="decimal"
                        value={tolPts}
                        onChange={(e) =>
                          setTolPts(e.target.value.replace(/[^0-9.]/g, ""))
                        }
                      />
                    </label>
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        flex: 1,
                        minWidth: 220,
                      }}
                    >
                      <span style={label}>
                        Days Gemini has to settle after the close (at least 1)
                      </span>
                      <input
                        style={input}
                        inputMode="numeric"
                        value={grace}
                        onChange={(e) =>
                          setGrace(e.target.value.replace(/[^0-9]/g, ""))
                        }
                      />
                    </label>
                  </div>
                </div>
              </details>
              {mine !== null && n > 0n && (
                <details>
                  <summary
                    style={{ cursor: "pointer", fontSize: 16, minHeight: 32 }}
                  >
                    How your money is held until someone joins
                  </summary>
                  <p
                    style={{
                      margin: "8px 0 0",
                      fontSize: 15,
                      lineHeight: 1.55,
                      color: C.body,
                    }}
                  >
                    Until someone joins, up to {$(mine)} is set aside from your
                    account (the price may move {tolPts || 0} points before they
                    join). The starting shares are set by the 30-second average
                    right after they join; anything above your share comes back
                    at once. If the price moves further than that before they
                    join, nobody pays anything. Whoever leaves early gives the other side 1% of
                    the pot.
                  </p>
                </details>
              )}
            </section>
          )}

          {market && (
            <section
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                maxWidth: 680,
              }}
            >
              <h2
                style={{
                  margin: 0,
                  fontFamily: F.cond,
                  fontSize: 32,
                  fontWeight: 600,
                }}
              >
                3. Give your word
              </h2>
              <label
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  fontSize: 16,
                  lineHeight: 1.45,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={practice}
                  onChange={(e) => (
                    setPractice(e.target.checked),
                    e.target.checked && Number(amount) > 1 && setAmount("0.50")
                  )}
                  style={{ width: 22, height: 22, marginTop: 2 }}
                />
                <span>
                  <strong>Practise alone:</strong> the practice cat
                  (HonorCat&apos;s own test account) takes the other side right
                  away, so you can watch the rope and leave within two minutes.
                  Pots up to ${PRACTICE_N}, test money only, and they do not
                  count towards your honor record.
                </span>
              </label>
              {!who.actor ? (
                <SignIn
                  who={who}
                  purpose="Your account holds your side of the pot. A passkey on this device is enough; HonorCat pays the network fees."
                />
              ) : (
                <>
                  <AccountLine who={who} />
                  {practice && seat && (
                    <div
                      role="radiogroup"
                      aria-label="Your opponent"
                      style={{
                        display: "flex",
                        gap: 16,
                        flexWrap: "wrap",
                        fontSize: 16,
                        paddingLeft: 32,
                      }}
                    >
                      <label
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="opponent"
                          checked={opponent === "cat"}
                          onChange={() => setOpponent("cat")}
                          style={{ width: 20, height: 20 }}
                        />
                        the practice cat (joins at once)
                      </label>
                      <label
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="radio"
                          name="opponent"
                          checked={opponent === "bot"}
                          onChange={() => setOpponent("bot")}
                          style={{ width: 20, height: 20 }}
                        />
                        my Grok Bot ({seat.label}): an AI player
                      </label>
                    </div>
                  )}
                  {bad && <Notice tone="note">{bad}</Notice>}
                  <Button
                    busy={!!step}
                    style={{ alignSelf: "flex-start" }}
                    disabled={!!bad || !!step}
                    onClick={submit}
                  >
                    {practice
                      ? opponent === "bot" && seat
                        ? "Give your word and invite my Grok Bot"
                        : "Give your word and play the practice cat"
                      : "Give your word"}
                  </Button>
                  <ActionProgress step={step} />
                  <FeeNote
                    fees={fees}
                    payer={who.actor.kind === "wallet" ? "wallet" : "honorcat"}
                  />
                </>
              )}
              {err && (
                <p
                  role="alert"
                  style={{ margin: 0, color: C.signalInk, fontSize: 16 }}
                >
                  {err}
                </p>
              )}
              {err?.startsWith("HonorCat's test money") && who.actor && (
                <FundsHelp account={who.actor.account} />
              )}
              <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
                Test version on Arc testnet: test money only. Not financial
                advice. Play within limits.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
