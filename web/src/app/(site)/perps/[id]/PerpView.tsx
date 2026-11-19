"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address } from "viem";
import { C, F } from "@/components/cat/tokens";
import { Lives } from "@/components/perp/Lives";
import { useLivePrice } from "@/components/pot/usePrice";
import { SignIn, useActor } from "@/components/pot/Who";
import { useTechMode } from "@/components/TechMode";
import { getJson, pollDelay, pollFast } from "@/lib/api";
import { ropesStatus, type HcPot } from "@/lib/hc";
import { plainError } from "@/lib/messages";
import { displayName, useNames } from "@/lib/names";
import {
  addLives,
  getPerp,
  getPerpRopes,
  joinPerp,
  leaveNow,
  DEFAULT_LIVES,
  lifeWords,
  perpLabel,
  playerOf,
  points,
  stopRenewing,
  times,
  treatOf,
  withdrawSpare,
  type PerpDetail,
  type PerpEvent,
  type RopeStory,
} from "@/lib/perp";
import { PerpChart } from "@/components/perp/PerpChart";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { RopePricing } from "@/components/perp/RopePricing";
import { Reactions } from "@/components/pot/Reactions";
import { SamplerNotice } from "@/components/pot/SamplerHealth";
import { useNow } from "@/lib/useNow";
import { money } from "@/lib/currency";

import { ActionProgress, Button } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { CatState } from "@/components/cat/CatState";
import { Rope } from "@/components/pot/Rope";
import { Invite, NotifyButton } from "@/components/pot/Invite";
import { sidesOf } from "@/lib/marketName";
import { furOf } from "@/lib/names";
const $ = (base: bigint | number | string) => money(base);
const signed = (base: bigint) =>
  `${base > 0n ? "+" : base < 0n ? "−" : ""}${money(base < 0n ? -base : base)}`;
const h2 = {
  margin: 0,
  fontFamily: F.cond,
  fontSize: 30,
  fontWeight: 600,
} as const;
const REASONS = [
  "someone left",
  "knocked out at a post",
  "time was up",
  "both agreed a price",
  "the market settled",
  "deposits went back",
] as const;

function clock(s: number) {
  if (s <= 0) return "ending now";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h} h ${m} min left`
    : m > 0
      ? `${m} min ${sec} s left`
      : `${sec} s left`;
}

/** Ropes so far, newest first: each start with how it ended and what each player got. */
function ropesOf(events: PerpEvent[]) {
  const out: {
    rope: number;
    pot: string | null;
    rolled: boolean;
    reason: number | null;
    paidA: bigint | null;
    paidB: bigint | null;
    at: number | null;
  }[] = [];
  for (const e of events) {
    if (e.name === "RopeStarted")
      out.push({
        rope: Number(e.args.rope),
        pot: e.pot,
        rolled: e.args.rolled === "true" || (e.args.rolled as unknown) === true,
        reason: null,
        paidA: null,
        paidB: null,
        at: e.at,
      });
    if (e.name === "RopeCredited") {
      const r = [...out].reverse().find((x) => x.reason === null);
      if (r)
        Object.assign(r, {
          reason: Number(e.args.reason),
          paidA: BigInt(e.args.paidA),
          paidB: BigInt(e.args.paidB),
        });
    }
  }
  return out.reverse();
}

const pts = (ppm: number) => (ppm / 10_000).toFixed(1);
const at = (s: number) =>
  new Date(s * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

/**
 * One rope's ending in plain words: what decided it, the 30-second window it was measured over and
 * each price sampler's own average (the contract takes the middle one).
 */
function replay(r: RopeStory): string | null {
  const d = r.decided;
  if (!d || d.kind === "entry") return null;
  const posts = `posts ${pts(r.lower)} and ${pts(r.upper)}`;
  const price = d.priceYes !== null ? pts(d.priceYes) : "?";
  const head =
    d.kind === "post"
      ? `Knocked out: the price held at ${price}, past the ${d.priceYes !== null && d.priceYes >= r.upper ? pts(r.upper) : pts(r.lower)} post, for 30 seconds`
      : d.kind === "expiry"
        ? `Time was up: divided at ${price} (${posts})`
        : `Someone left: divided at ${price} (${posts})`;
  const samplers = d.averages.length
    ? ` The ${d.averages.length} price samplers measured ${d.averages
        .map((a) => (a.valid ? pts(a.priceYes) : "no price"))
        .join(", ")}; the contract took the middle one.`
    : "";
  const retries =
    r.unagreed > 0
      ? ` Before that, ${r.unagreed} price ${r.unagreed === 1 ? "check" : "checks"} gave no price (Gemini's order book was too wide or too thin for long enough), so the rope ran on.`
      : "";
  return `${head}, measured ${at(d.windowStart)} to ${at(d.windowEnd)}.${samplers}${retries}`;
}

export function PerpView({ id }: { id: string }) {
  const who = useActor();
  const { tech } = useTechMode();
  const now = useNow();
  const [p, setP] = useState<PerpDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [askLeave, setAskLeave] = useState(false);
  const [practiceFailed, setPracticeFailed] = useState(false);
  useEffect(() => {
    if (
      new URLSearchParams(window.location.search).get("practice") === "failed"
    )
      void Promise.resolve().then(() => setPracticeFailed(true));
  }, []);
  const [rope, setRope] = useState<HcPot | null>(null);
  const [stories, setStories] = useState<RopeStory[]>([]);
  const [perps, setPerps] = useState<Address | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [joinLives, setJoinLives] = useState(String(DEFAULT_LIVES));
  const [more, setMore] = useState("1");
  const [ended, setEnded] = useState<{ text: string; key: number } | null>(
    null,
  );
  const seen = useRef<number | null>(null);

  useEffect(() => {
    ropesStatus()
      .then((r) => setPerps(r.perps))
      .catch(() => {});
  }, []);
  useEffect(() => {
    let alive = true;
    const load = () =>
      getPerp(id)
        .then((d) => {
          if (!alive) return;
          setP(d);
          setLoadErr(null);
        })
        .catch((e) => {
          if (!alive) return;
          if (/404|no such perp/i.test(String(e))) setMissing(true);
          else setLoadErr(plainError(e));
        });
    let t: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await load();
      if (alive) t = setTimeout(loop, pollDelay(5000));
    };
    void loop();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [id]);
  const potDb = p?.data.potDb ?? null;
  useEffect(() => {
    if (!potDb) return;
    let alive = true;
    const load = () =>
      getJson<HcPot>(`/api/hc/pots/${potDb}`)
        .then((r) => alive && setRope(r))
        .catch(() => {});
    let t: ReturnType<typeof setTimeout> | null = null;
    const loop = async () => {
      await load();
      if (alive) t = setTimeout(loop, pollDelay(5000));
    };
    void loop();
    return () => {
      alive = false;
      if (t) clearTimeout(t);
    };
  }, [potDb]);

  const ropeEvents = p?.events.length ?? 0;
  const phaseNow = p?.phase;
  useEffect(() => {
    if (!ropeEvents) return;
    let alive = true;
    const load = () =>
      getPerpRopes(id)
        .then((r) => alive && setStories(r.ropes))
        .catch(() => {});
    void load();
    const t = phaseNow === "Ended" ? null : setInterval(load, 15_000);
    return () => {
      alive = false;
      if (t) clearInterval(t);
    };
  }, [id, ropeEvents, phaseNow]);

  const live = useLivePrice(p?.market?.instrument ?? null);
  const names = useNames([p?.a, p?.b]);
  const me = playerOf(p ?? { a: "", b: null }, who.actor?.account);
  const history = useMemo(() => (p ? ropesOf(p.events) : []), [p]);
  const credited = history.filter((r) => r.reason !== null).length;

  // A rope that ends while the page is open gets a short moment of its own.
  useEffect(() => {
    if (!p) return;
    if (seen.current !== null && credited > seen.current) {
      const r = history.find((x) => x.reason !== null)!;
      const aLost = r.paidA !== null && r.paidA === 0n;
      const bLost = r.paidB !== null && r.paidB === 0n;
      const loser = aLost
        ? displayName(p.a, names, who.actor?.account, tech)
        : bLost
          ? displayName(p.b, names, who.actor?.account, tech)
          : null;
      const text = `Rope ${r.rope} ended: ${REASONS[r.reason!] ?? "it ended"}.${loser ? ` ${loser.charAt(0).toUpperCase() + loser.slice(1)} lost a life.` : ""}`;
      void Promise.resolve().then(() => setEnded({ text, key: Date.now() }));
    }
    seen.current = credited;
  }, [credited, p, history, names, who.actor?.account, tech]);

  if (missing && !p)
    return (
      <CatState
        kind="empty"
        text={`No perp ${id} yet. A new perp takes a few seconds to appear; check the link otherwise.`}
      />
    );
  if (!p && loadErr) return <CatState kind="error" text={loadErr} />;
  if (!p)
    return <CatState kind="loading" text={`Reading perp ${id} from Arc…`} />;

  const d = p.data;
  const stake = BigInt(d.stake);
  const sideA = d.t.creatorSide;
  const nm = (a: string | null) =>
    displayName(a, names, who.actor?.account, tech);
  const rd = rope?.data as unknown as Record<string, string> | undefined;
  const lower = rd ? Number(rd.lower) : null;
  const upper = rd ? Number(rd.upper) : null;
  // The price the leverages are shown at: this rope's entry, else the relay's (rope entry or market
  // price), else the live price.
  const center =
    lower !== null
      ? lower + d.t.d
      : (p.market?.center ??
        (live.smoothed !== null ? Math.round(live.smoothed * 1e6) : null));
  const levA =
    center === null ? null : (sideA === 0 ? center : 1e6 - center) / d.t.d;
  const levB =
    center === null ? null : (sideA === 0 ? 1e6 - center : center) / d.t.d;
  const label =
    levA !== null && levB !== null
      ? perpLabel(d.t.d, levA, levB)
      : `Perp, rope ${points(d.t.d)} points`;
  const st = p.market ? sidesOf(p.market) : null;
  const sideWord = (s: number) =>
    st ? `“${s === 0 ? st.yesShort : st.noShort}”` : s === 0 ? "YES" : "NO";
  const question = p.market
    ? `${p.market.eventTitle}${p.market.label && p.market.label !== "Yes" ? `: ${p.market.label}` : ""}`
    : "the market";
  const lostOf = (x: "a" | "b") =>
    history.filter(
      (r) => r.reason === 1 && (x === "a" ? r.paidA : r.paidB) === 0n,
    ).length;
  const expiry = rd ? Number(rd.expiry) : 0;
  const left = expiry ? expiry - Math.floor(now / 1000) : null;
  const price = live.smoothed;

  const run = async (f: () => Promise<unknown>, ok?: string) => {
    setErr(null);
    try {
      await f();
      setStep(null);
      if (ok) toast(ok);
      pollFast();
      setP(await getPerp(id));
    } catch (e) {
      setErr(plainError(e));
      setStep(null);
    }
  };

  const player = (x: "a" | "b") => {
    const acct = x === "a" ? p.a : p.b;
    const side = x === "a" ? sideA : 1 - sideA;
    const free = BigInt(x === "a" ? d.freeA : d.freeB);
    // Lives: whole stakes not in a rope, plus the one in the running rope.
    const lives =
      Number(x === "a" ? d.livesA : d.livesB) +
      (p.phase === "Running" || p.phase === "Joining" ? 1 : 0);
    const result = BigInt(x === "a" ? d.resultA : d.resultB);
    const renew = x === "a" ? d.renewA : d.renewB;
    const lev = x === "a" ? levA : levB;
    return (
      <div
        key={x}
        style={{
          flex: "1 1 280px",
          border: `1.5px solid ${C.ink}`,
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <span style={{ fontSize: 14, color: C.muted }}>
          {x === "a" ? "Opened the perp" : "Took the other side"} ·{" "}
          {side === 0 ? "YES" : "NO"}
          {lev !== null && ` · ${times(lev)}`}
        </span>
        <strong style={{ fontSize: 20 }}>
          {acct ? nm(acct) : "open seat"}
        </strong>
        {acct && (
          <>
            <span
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                fontSize: 16,
              }}
            >
              <Lives left={lives} lost={lostOf(x)} size={20} />
              <span>
                {lives} {lives === 1 ? "life" : "lives"} left
                {lostOf(x) > 0 ? `, ${lostOf(x)} lost` : ""}
              </span>
            </span>
            <span style={{ fontSize: 14, color: C.muted }}>
              A life is {$(stake)}: lost when the price holds past{" "}
              this player&apos;s post for 30
              seconds.
            </span>
            <span style={{ fontSize: 16 }}>
              Result so far: <strong>{signed(result)}</strong>
            </span>
            <span style={{ fontSize: 15, color: C.muted }}>
              {$(free)} not in a rope
              {p.phase !== "Ended" && !renew ? " · stopped renewing" : ""}
            </span>
          </>
        )}
      </div>
    );
  };

  const mine = me
    ? {
        free: BigInt(me === "a" ? d.freeA : d.freeB),
        lives: Number(me === "a" ? d.livesA : d.livesB),
        renew: me === "a" ? d.renewA : d.renewB,
      }
    : null;
  // Spare money: what is not a whole life while the chain runs; everything once it ended.
  const spare = mine
    ? p.phase === "Ended"
      ? mine.free
      : mine.free % stake
    : 0n;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 820,
      }}
    >
      <style>{`@keyframes perpDrop { 0% { transform: translateY(-12px); opacity: 0 } 15% { transform: none; opacity: 1 } 85% { opacity: 1 } 100% { opacity: 0 } }`}</style>
      {ended && (
        <div
          key={ended.key}
          role="status"
          onAnimationEnd={() => setEnded(null)}
          style={{
            animation: "perpDrop 6s ease-out forwards",
            background: C.ink,
            color: C.page,
            padding: "14px 18px",
            fontSize: 20,
            fontFamily: F.cond,
            fontWeight: 600,
          }}
        >
          {ended.text}
        </div>
      )}
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 15, color: C.muted }}>
          <Link href="/perps">All perps</Link>
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: F.cond,
            fontSize: "clamp(40px, 8vw, 56px)",
            fontWeight: 600,
            lineHeight: 0.95,
          }}
        >
          Perp {id}
        </h1>
        <p style={{ margin: 0, fontSize: 19 }}>{label}</p>
        {p.practice && (
          <p
            role="note"
            style={{
              margin: 0,
              padding: "10px 14px",
              border: `1.5px solid ${C.ink}`,
              fontSize: 16,
              lineHeight: 1.45,
              maxWidth: 760,
            }}
          >
            <strong>Practice perp.</strong> The other side is the practice cat,
            HonorCat&apos;s own test account. It never leaves or stops on its
            own: leave now, stop renewing, or let the lives run out. Test money
            only.
          </p>
        )}
        {practiceFailed && p.phase === "Open" && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 17,
              color: C.signalInk,
              maxWidth: 760,
            }}
          >
            The practice cat could not take the other side just now. Your perp
            waits for a real player: send the link, or cancel it below and get
            your money back.
          </p>
        )}
        {p.market?.eventTicker && (
          <span style={{ fontSize: 15 }}>
            <GeminiLink ticker={p.market.eventTicker} slug={p.market.slug} label="Trade this market on Gemini" size={15} />
          </span>
        )}
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>
          On “{question}”. Each rope, both put in {$(stake)}; a rope lasts at
          most {lifeWords(Number(d.t.ropeLife))}.
        </p>
        <p style={{ margin: 0, fontSize: 17 }}>
          <strong>
            {p.phase === "Open"
              ? "Waiting for someone to take the other side."
              : p.phase === "Funded"
                ? "Both are in: the first rope starts in a moment."
                : p.phase === "Joining"
                  ? "The first rope is starting: its price is being measured over 30 seconds."
                  : p.phase === "Running"
                    ? d.leaving
                      ? "Someone is leaving: this rope is being priced, then the perp ends."
                      : rd && Number(rd.expiryTry ?? 0) >= 4
                        ? `Rope ${d.ropes} is past its end and waits for the market's result.`
                        : `Rope ${d.ropes} is running.`
                    : `Ended after ${d.ropes} ${d.ropes === 1 ? "rope" : "ropes"}${(() => {
                        const why = p.events.find((e) => e.name === "PerpEnded")
                          ?.args.why;
                        return why ? `: ${why}` : "";
                      })()}.`}
          </strong>
        </p>
      </header>

      {p.phase !== "Ended" && p.phase !== "Open" && <SamplerNotice />}
      {(p.phase === "Joining" || p.phase === "Running") && potDb && (
        <RopePricing expiryTries={rd ? Number(rd.expiryTry ?? 0) : 0} potId={potDb} expiry={expiry} leaving={d.leaving} />
      )}

      {p.phase === "Running" && lower !== null && upper !== null && (
        <section
          aria-label="The rope"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <Rope
            price={price}
            notional={stake * 2n}
            names={{
              yes: nm(sideA === 0 ? p.a : p.b),
              no: nm(sideA === 0 ? p.b : p.a),
            }}
            phase="live"
            posts={{ lower: lower / 1e6, upper: upper / 1e6 }}
            zoom={[
              Math.max(0, lower / 1e6 - (upper - lower) / 4e6),
              Math.min(1, upper / 1e6 + (upper - lower) / 4e6),
            ]}
            sides={st ?? undefined}
            trail={live.trail}
            speed={live.speed}
            cats={{
              yes: {
                fur: furOf(sideA === 0 ? p.a : p.b),
                mood: "even",
                name: nm(sideA === 0 ? p.a : p.b),
              },
              no: {
                fur: furOf(sideA === 0 ? p.b : p.a),
                mood: "even",
                name: nm(sideA === 0 ? p.b : p.a),
              },
            }}
          />
          <Reactions potId={`-${id}`} />
          <p style={{ margin: 0, fontSize: 17 }}>
            <strong>Rope {d.ropes}</strong>
            {left !== null ? ` · ${clock(left)}` : ""} · past {points(lower)}{" "}
            the NO side wins this rope, past {points(upper)} the YES side.
          </p>
          {rope && (
            <span style={{ fontSize: 14, color: C.muted }}>
              This rope is{" "}
              <Link href={`/pots/${rope.potId}`}>pot {rope.potId}</Link>.
            </span>
          )}
        </section>
      )}

      {p.market && stories.some((r) => r.armedAt > 0) && (
        <section
          aria-label="Price and ropes"
          style={{ display: "flex", flexDirection: "column", gap: 10 }}
        >
          <h2 style={h2}>Price and ropes</h2>
          <PerpChart
            symbol={p.market.instrument}
            ropes={stories}
            now={now}
            live={p.phase === "Running" ? price : null}
          />
        </section>
      )}

      <section style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {player("a")}
        {player("b")}
      </section>

      {p.phase === "Open" && me !== "a" && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Take the other side</h2>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5 }}>
            You play {sideWord(1 - sideA)}
            {levB !== null ? ` at ${times(levB)}` : ""} ({nm(p.a)} plays{" "}
            {sideWord(sideA)}
            {levA !== null ? ` at ${times(levA)}` : ""}). Each rope, both put in{" "}
            {$(stake)}; past your post you lose it, past theirs you win theirs.
          </p>
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxWidth: 220,
            }}
          >
            <span style={{ fontSize: 15, fontWeight: 600 }}>Your lives</span>
            <input
              inputMode="numeric"
              value={joinLives}
              onChange={(e) =>
                setJoinLives(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))
              }
              style={{
                minHeight: 48,
                padding: "0 12px",
                border: `1.5px solid ${C.ink}`,
                background: C.page,
                fontSize: 18,
              }}
            />
          </label>
          {(() => {
            const n = BigInt(Math.max(0, Number(joinLives) || 0));
            const budget = n * stake + treatOf(stake);
            if (!who.actor)
              return (
                <SignIn who={who} purpose="Sign in to take the other side." />
              );
            return (
              <>
                <p
                  style={{
                    margin: 0,
                    fontSize: 16,
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <Lives left={Number(n)} size={18} /> {String(n)} lives:{" "}
                  {$(n * stake)}, plus a {$(treatOf(stake))} maker treat to{" "}
                  {nm(p.a)} on the first rope.
                </p>
                <Button
                  busy={!!step}
                  style={{ alignSelf: "flex-start" }}
                  disabled={!!step || n < 1n || !perps}
                  onClick={() =>
                    run(
                      () => joinPerp(who.actor!, perps!, id, budget, setStep),
                      "You joined. The first rope starts within a minute.",
                    )
                  }
                >
                  {`Give your word and join (${$(budget)})`}
                </Button>
                <ActionProgress step={step} />
              </>
            );
          })()}
        </section>
      )}

      {p.phase === "Open" && me === "a" && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Invite someone</h2>
          <p style={{ margin: 0, fontSize: 17, color: C.body }}>
            Send this page to the player who takes {sideWord(1 - sideA)}. They
            choose their own lives.
          </p>
          <Invite
            path={`/perps/${id}`}
            text={`Take the other side of my HonorCat perp${st ? `: ${st.yes}?` : ""}`}
            potId={`-${id}`}
            account={who.actor?.account ?? null}
          />
        </section>
      )}

      {me && mine && perps && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Your perp</h2>
          {p.phase !== "Ended" && p.phase !== "Open" && (
            <div>
              <NotifyButton
                potId={`-${id}`}
                account={who.actor?.account ?? null}
                when="change"
              />
            </div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {p.phase === "Running" && !d.leaving && (
              <>
                {askLeave ? (
                  <Notice tone="warning">
                    <strong>Leave now and end the perp?</strong>
                    <span>
                      This rope is priced over the next 30 seconds; you give 1%
                      of what you take out to the other side. No new rope starts
                      after it.
                    </span>
                    <div
                      style={{
                        display: "flex",
                        gap: 12,
                        flexWrap: "wrap",
                        marginTop: 8,
                      }}
                    >
                      <Button
                        busy={!!step}
                        onClick={() =>
                          run(
                            () => leaveNow(who.actor!, perps, id, setStep),
                            "You are leaving. The rope is being priced; the perp ends in about a minute.",
                          ).then(() => setAskLeave(false))
                        }
                      >
                        Yes, leave now
                      </Button>
                      <Button
                        variant="quiet"
                        disabled={!!step}
                        onClick={() => setAskLeave(false)}
                      >
                        Keep playing
                      </Button>
                      <ActionProgress step={step} />
                    </div>
                  </Notice>
                ) : (
                  <Button disabled={!!step} onClick={() => setAskLeave(true)}>
                    Leave now
                  </Button>
                )}
              </>
            )}
            {p.phase !== "Ended" && mine.renew && p.phase !== "Open" && (
              <Button
                variant="quiet"
                disabled={!!step}
                onClick={() =>
                  run(
                    () => stopRenewing(who.actor!, perps, id, setStep),
                    "Renewing is off. This rope runs to its end, then the perp ends.",
                  )
                }
              >
                Stop renewing
              </Button>
            )}
            {spare > 0n && (
              <Button
                variant="quiet"
                disabled={!!step}
                onClick={() =>
                  run(() =>
                    withdrawSpare(who.actor!, perps, id, spare, setStep),
                  )
                }
              >
                {p.phase === "Ended" || (p.phase === "Open" && me === "a")
                  ? `Take out ${$(spare)}`
                  : `Take out spare money (${$(spare)})`}
              </Button>
            )}
            {p.phase === "Open" && me === "a" && (
              <Button
                variant="quiet"
                disabled={!!step}
                onClick={() =>
                  run(() =>
                    withdrawSpare(who.actor!, perps, id, mine.free, setStep),
                  )
                }
              >
                Cancel and get my {$(mine.free)} back
              </Button>
            )}
          </div>
          {p.phase !== "Ended" && (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <label
                style={{ display: "flex", flexDirection: "column", gap: 6 }}
              >
                <span style={{ fontSize: 15, fontWeight: 600 }}>Add lives</span>
                <input
                  inputMode="numeric"
                  value={more}
                  onChange={(e) =>
                    setMore(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))
                  }
                  style={{
                    minHeight: 48,
                    width: 90,
                    padding: "0 12px",
                    border: `1.5px solid ${C.ink}`,
                    background: C.page,
                    fontSize: 18,
                  }}
                />
              </label>
              <Button
                variant="quiet"
                disabled={!!step || !(Number(more) > 0)}
                onClick={() =>
                  run(() =>
                    addLives(
                      who.actor!,
                      perps,
                      id,
                      BigInt(Number(more)) * stake,
                      setStep,
                    ),
                  )
                }
              >
                Add {Number(more) || 0} for{" "}
                {$(BigInt(Number(more) || 0) * stake)}
              </Button>
            </div>
          )}
          {p.phase !== "Ended" && (
            <p
              style={{
                margin: 0,
                fontSize: 15,
                color: C.muted,
                lineHeight: 1.5,
              }}
            >
              Leave now: this rope is priced over the next 30 seconds and you
              give 1% of what you take out to the other side; then the perp
              ends. Stop renewing: this rope runs to its end, and no new one
              starts.
            </p>
          )}
        </section>
      )}
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}

      {history.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={h2}>How each rope went</h2>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {history.map((r) => (
              <li
                key={r.rope}
                style={{
                  display: "flex",
                  gap: 12,
                  flexWrap: "wrap",
                  alignItems: "baseline",
                  borderTop: `1px solid ${C.faint}`,
                  padding: "10px 0",
                  fontSize: 16,
                }}
              >
                <strong style={{ minWidth: 70 }}>Rope {r.rope}</strong>
                <span style={{ flex: "1 1 200px" }}>
                  {r.reason !== null
                    ? (REASONS[r.reason] ?? "ended")
                    : p.phase === "Running" && r.rope === d.ropes
                      ? "running"
                      : "ended (details in a moment)"}
                  {r.rolled ? " · started at the last rope's price" : ""}
                </span>
                {r.paidA !== null && r.paidB !== null && (
                  <span style={{ color: C.body }}>
                    {nm(p.a)} {signed(r.paidA - stake)} · {nm(p.b)}{" "}
                    {signed(r.paidB - stake)}
                  </span>
                )}
                {r.pot && <Link href={`/pots/${r.pot}`}>pot {r.pot}</Link>}
                {(() => {
                  const st = stories.find((x) => x.rope === r.rope);
                  const line = st ? replay(st) : null;
                  return line ? (
                    <span
                      style={{
                        flexBasis: "100%",
                        fontSize: 15,
                        color: C.body,
                        lineHeight: 1.5,
                      }}
                    >
                      {line}
                      {tech && st?.decided?.tx && (
                        <>
                          {" "}
                          <a
                            href={`https://explorer.testnet.arc.io/tx/${st.decided.tx}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            transaction
                          </a>
                        </>
                      )}
                    </span>
                  ) : null;
                })()}
              </li>
            ))}
          </ol>
        </section>
      )}

      <p
        role="note"
        style={{
          margin: 0,
          fontSize: 16,
          lineHeight: 1.5,
          border: `2px solid ${C.signal}`,
          padding: "10px 14px",
        }}
      >
        <strong>A life can be lost in minutes.</strong> A move of{" "}
        {points(d.t.d)} points ends a rope; on live games the price can jump
        that far at once.
      </p>
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
        Test version on Arc testnet: test money only. Not financial advice. Play
        within limits.
      </p>
    </div>
  );
}
