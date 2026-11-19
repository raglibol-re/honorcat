"use client";

import { Watching } from "@/components/pot/Watching";
import { PrivateControl } from "@/components/pot/PrivateControl";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Cat } from "@/components/cat/Cat";
import { PlayerCat } from "@/components/cat/PlayerCat";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { GeminiCredit } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { AfterPot } from "@/components/pot/AfterPot";
import { PriceChart } from "@/components/pot/PriceChart";
import { FeeNote, Receipts, useFees } from "@/components/pot/Receipts";
import { cents, receiptsOf } from "@/lib/receipts";
import { SendTo } from "@/components/pot/SendTo";
import { AgentPanel } from "@/components/agent/AgentPanel";
import type { AgentInfo } from "@/lib/agent";
import { HelperBubble } from "@/components/helper/Helper";
import { adviceFree, exitOptions, levelOptions, readWish } from "@/lib/helper";
import { SamplerNotice } from "@/components/pot/SamplerHealth";
import { RopePricing } from "@/components/perp/RopePricing";
import { RivalryLine } from "@/components/pot/Rivalry";
import { Reactions } from "@/components/pot/Reactions";
import { PlayersHonor } from "@/components/honor/Honor";
import { asV1Pot, sceneOf, storyOf } from "@/components/pot/scene";
import { ShortRopeNote } from "@/components/pot/RopeControl";
import { RopeLives } from "@/components/pot/RopeLives";
import { RopeActions } from "@/components/pot/RopeActions";
import { GeminiCard } from "@/components/cat/GeminiCard";
import { PotStatusLine } from "@/components/pot/Status";
import { useTechMode } from "@/components/TechMode";
import { marketLine, sidesOf, yesMeans, type Sides } from "@/lib/marketName";
import { displayName, FURS, furOf, useNames } from "@/lib/names";
import { useLivePrice } from "@/components/pot/usePrice";
import {
  AccountLine,
  FundsHelp,
  SignIn,
  useActor,
  type ActorState,
} from "@/components/pot/Who";
import { ActionProgress, Button } from "@/components/ui/Button";
import { Invite, NotifyButton } from "@/components/pot/Invite";
import { toast } from "@/components/ui/Toast";
import { getJson, pollFast, usePolling } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { formatDate, short } from "@/lib/format";
import {
  cancelPot,
  feeOf,
  joinPot,
  requestExit,
  setLevels,
  sideOf,
  signHandshake,
  takeover,
  worstCase,
  YES,
  type HcPot,
} from "@/lib/hc";
import { useNow } from "@/lib/useNow";
import { plainError } from "@/lib/messages";
import { shareOf } from "@/lib/shares";
import { money, useHome } from "@/lib/currency";
import { RateNote } from "@/components/cat/Currency";

const POTS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59" as const;
const h2: React.CSSProperties = {
  margin: 0,
  fontFamily: F.cond,
  fontSize: 32,
  fontWeight: 600,
};
const input: React.CSSProperties = {
  minHeight: 44,
  padding: "0 10px",
  border: `1.5px solid ${C.ink}`,
  background: C.page,
  fontFamily: F.sans,
  fontSize: 17,
  color: C.ink,
  width: 120,
  boxSizing: "border-box",
};
const $ = (base: bigint | string | number) => money(base);
/** What a measured window was for; nets and bowls by the side they belong to. */
const kindText = (k: number, st: Sides | null) => {
  const side = (s: number) =>
    st ? `“${s === 0 ? st.yes : st.no}”` : s === 0 ? "YES" : "NO";
  return (
    [
      "Entry price",
      "Exit price",
      `Net of ${side(0)}`,
      `Net of ${side(1)}`,
      `Bowl of ${side(0)}`,
      `Bowl of ${side(1)}`,
      "Quote (fair value, moves no money)",
    ][k] ?? "Price"
  );
};
const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;

/**
 * The three amounts that matter to a player, large: what they get if they leave now (an estimate:
 * the exit is priced over the next 30 seconds), if they stay and their side happens, and if they
 * stay and it does not.
 */
function ThreeNumbers({
  pot,
  side,
  price,
  st,
}: {
  pot: HcPot;
  side: number;
  price: number | null;
  st: Sides | null;
}) {
  const n = BigInt(pot.data.notional);
  const share = price === null ? null : shareOf(n, price, side);
  const fee = feeOf(n, Number(pot.data.feeBps));
  const leave = share === null ? null : share > fee ? share - fee : 0n;
  const mine = st ? (side === YES ? st.yes : st.no) : "your side happens";
  const cell = (label: string, v: bigint | null, note: string) => (
    <div
      style={{
        flex: "1 1 200px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "12px 0",
        borderTop: `1.5px solid ${C.ink}`,
      }}
    >
      <span style={{ fontSize: 16, color: C.body }}>{label}</span>
      <span
        style={{
          fontFamily: F.cond,
          fontSize: 64,
          fontWeight: 600,
          lineHeight: 0.9,
        }}
      >
        {v === null ? "…" : $(v)}
      </span>
      <span style={{ fontSize: 14, color: C.muted }}>{note}</span>
    </div>
  );
  return (
    <section
      aria-label="What you get"
      style={{ display: "flex", flexWrap: "wrap", gap: "0 28px" }}
    >
      {cell(
        "If I leave now",
        leave,
        `About: the exit price is the average of the next 30 seconds; after a ${$(fee)} treat for the other cat.`,
      )}
      {cell(
        "If I stay and it happens",
        n,
        `The whole pot, when Gemini settles that ${mine}.`,
      )}
      {cell(
        "If I stay and it does not",
        0n,
        "Nothing; the other side gets the pot.",
      )}
    </section>
  );
}

function useAction() {
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (
    f: (s: (x: string) => void) => Promise<{ tx?: string } | unknown>,
    ok: string,
  ) => {
    setErr(null);
    setDone(null);
    try {
      setStep("Preparing");
      await f(setStep);
      setDone(ok);
      toast(ok);
      pollFast();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setStep(null);
    }
  };
  return { step, err, done, run };
}

function Feedback({
  a,
  account,
}: {
  a: ReturnType<typeof useAction>;
  account?: string | null;
}) {
  return (
    <>
      {a.err?.startsWith("HonorCat's test money") && account && (
        <FundsHelp account={account} />
      )}
      <ActionProgress step={a.step} />
      {a.done && <CatState kind="success" text={a.done} size={90} />}
      {a.err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {a.err}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ actions by role */

function Actions({
  pot,
  who,
  price,
  nowS,
  nameOf,
}: {
  pot: HcPot;
  who: ActorState;
  price: number | null;
  nowS: number;
  nameOf: (a: string | null) => string;
}) {
  const st = pot.market ? sidesOf(pot.market) : null;
  const says = (s: number) =>
    st ? `“${s === YES ? st.yes : st.no}”` : s === YES ? "YES" : "NO";
  const a = useAction();
  const me = who.actor?.account ?? null;
  const mySide = sideOf(pot, me);
  const d = pot.data;
  const n = BigInt(d.notional);
  const creatorSide = Number(d.creatorSide);
  const isCreator = mySide === creatorSide;
  const [part, setPart] = useState("");
  // Start from the side's saved levels, so saving one never wipes the other.
  const savedLv = mySide === null ? null : ((d as unknown as { levels?: ({ net: number; bowl: number } | null)[] }).levels?.[mySide] ?? null);
  const [net, setNet] = useState("");
  const [bowl, setBowl] = useState("");
  const [lvFilled, setLvFilled] = useState(false);
  if (!lvFilled && savedLv) {
    setLvFilled(true);
    if (savedLv.net > 0) setNet(String(savedLv.net / 10_000));
    if (savedLv.bowl > 0) setBowl(String(savedLv.bowl / 10_000));
  }
  const netN = Number(net) || 0;
  const bowlN = Number(bowl) || 0;
  const levelsBad =
    netN > 100 || bowlN > 100
      ? "Levels are chances between 0 and 100."
      : netN > 0 && bowlN > 0 && netN >= bowlN
        ? "The net must be below the bowl."
        : null;
  // The exit the player is about to confirm (amount of the pot to divide, in words).
  const [ask, setAsk] = useState<{ amount: bigint; what: string } | null>(null);
  const fees = useFees();
  // The helper cat on nets and bowls: shown once the player starts on them; and the wish box.
  const [levelsHelp, setLevelsHelp] = useState(false);
  const [wish, setWish] = useState("");
  const [wishNote, setWishNote] = useState<string | null>(null);
  const offers = usePolling<{
    offers: {
      side: number;
      price_yes: number;
      notional: string;
      deadline: string;
    }[];
  }>(pot.state === "Live" ? `/api/hc/pots/${pot.potId}/handshake` : null, 5000);
  const lockout = Math.max(120, 1 + Number(d.window) + 60);
  const tooLate = nowS + lockout >= Number(d.closeTime);

  if (pot.state === "Open") {
    if (isCreator)
      return (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Invite someone</h2>
          <p style={{ margin: 0, color: C.body, fontSize: 17 }}>
            Send this page to the person who takes the other side. They join
            with a passkey or a wallet; nobody pays network fees.
          </p>
          <Invite
            path={`/pots/${pot.potId}${(pot as { privateKey?: string | null }).privateKey ? `?k=${(pot as { privateKey?: string | null }).privateKey}` : ""}`}
            text={`Take the other side of my HonorCat pot${pot.market ? `: ${sidesOf(pot.market).yes}?` : ""}`}
            potId={pot.potId}
            account={me}
          />
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              borderTop: `1.5px solid ${C.ink}`,
              paddingTop: 14,
              marginTop: 6,
            }}
          >
            <strong
              style={{ fontFamily: F.cond, fontSize: 24, fontWeight: 600 }}
            >
              Changed your mind?
            </strong>
            <span style={{ fontSize: 16, color: C.body }}>
              Nobody has joined yet. Cancel and your money comes straight back
              to your account.
            </span>
            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <Button
                variant="quiet"
                busy={!!a.step}
                onClick={() =>
                  who.actor &&
                  a.run(
                    (s) => cancelPot(who.actor!, POTS, pot, s),
                    "Cancelled. Your money is back in your account.",
                  )
                }
              >
                Cancel and get my money back
              </Button>
            </div>
          </div>
          <Feedback a={a} account={who.actor?.account ?? null} />
        </section>
      );
    const side = 1 - creatorSide;
    const dep = worstCase(side, n, Number(d.bandCenter), Number(d.tolerance));
    return (
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          maxWidth: 680,
        }}
      >
        {(() => {
          const creator = creatorSide === YES ? pot.owners.yes : pot.owners.no;
          return (
            creator && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 14 }}>
                <PlayerCat
                  account={creator}
                  pose="sit"
                  size={96}
                  label={`${nameOf(creator)}'s cat, waiting at its post`}
                />
                <p style={{ margin: 0, fontSize: 19, lineHeight: 1.4 }}>
                  <strong>{nameOf(creator)}</strong> holds {says(creatorSide)}{" "}
                  and waits for someone to take the other side.
                </p>
              </div>
            )
          );
        })()}
        <h2 style={h2}>Take the side {says(side)}</h2>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          You put in up to <strong>{$(dep)}</strong>. Your starting share is set
          by the 30-second average price right after you join (it must stay
          within {(Number(d.tolerance) / 10_000).toFixed(1)} points of{" "}
          {(Number(d.bandCenter) / 10_000).toFixed(1)}% chance); the rest comes
          straight back. If the samplers cannot agree on a price, you get
          everything back.
        </p>
        {!who.actor ? (
          <SignIn
            who={who}
            purpose="Your account holds your side. A passkey on this device is enough."
          />
        ) : (
          <>
            <AccountLine who={who} />
            <Button
              style={{ alignSelf: "flex-start" }}
              busy={!!a.step}
              disabled={!!a.step || tooLate}
              onClick={() =>
                a.run(
                  (s) => joinPot(who.actor!, POTS, pot, s),
                  "Joined. The entry price is being measured.",
                )
              }
            >
              {tooLate
                ? "Too close to the market's close"
                : `Give your word (${$(dep)})`}
            </Button>
            <FeeNote
              fees={fees}
              payer={who.actor.kind === "wallet" ? "wallet" : "honorcat"}
            />
          </>
        )}
        <Feedback a={a} account={who.actor?.account ?? null} />
      </section>
    );
  }

  if (pot.state === "ExitRequested") {
    const full = d.exitNotional === d.notional;
    const end = Number(d.requestTime) + 1 + Number(d.window);
    if (
      mySide === null &&
      full &&
      d.joiner === "0x0000000000000000000000000000000000000000" &&
      nowS < end
    )
      return (
        <section
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            maxWidth: 680,
          }}
        >
          <h2 style={h2}>Take over the side {says(Number(d.exitSide))}</h2>
          <p
            style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}
          >
            You put in {$(n)}. The leaving side is paid its share at the exit
            price from you instead of from the pot, and you hold its place; the
            rest of your deposit comes back. If the exit price cannot be
            measured, you get everything back.
          </p>
          {!who.actor ? (
            <SignIn
              who={who}
              purpose="Your account will hold the side you take over."
            />
          ) : (
            <Button
              style={{ alignSelf: "flex-start" }}
              busy={!!a.step}
              disabled={!!a.step}
              onClick={() =>
                a.run(
                  (s) => takeover(who.actor!, POTS, pot, s),
                  "Offer in. It completes at the exit price.",
                )
              }
            >
              Take over with {$(n)}
            </Button>
          )}
          <Feedback a={a} account={who.actor?.account ?? null} />
        </section>
      );
    return null;
  }

  if (pot.state !== "Live" || mySide === null) {
    if (pot.state === "Live" && !who.actor)
      return <SignIn who={who} purpose="Sign in to see your side's options." />;
    return null;
  }

  const own = price === null ? null : mySide === YES ? price : 1 - price;
  const initial = BigInt(
    (d as { initialNotional?: string }).initialNotional ?? d.notional,
  );
  const ninth = initial / 9n;
  const lives =
    initial > 0n
      ? Math.max(0, Math.min(9, Math.round((9 * Number(n)) / Number(initial))))
      : 9;
  const cooldown = nowS < Number(d.cooldownUntil);
  const blocked = tooLate
    ? "Exits are closed in the last minutes before the market's close."
    : cooldown
      ? `A failed exit window just ended; try again in ${Number(d.cooldownUntil) - nowS} s.`
      : null;
  const other = offers.data?.offers.find((o) => o.side !== mySide);
  const mineOffer = offers.data?.offers.find((o) => o.side === mySide);
  const lv = d.levels?.[mySide];
  const acceptHandshake = () =>
    other &&
    a.run(async (s) => {
      const sig = await signHandshake(
        who.actor!,
        POTS,
        pot,
        other.price_yes,
        BigInt(other.notional),
        BigInt(other.deadline),
        s,
      );
      return getJson(`/api/hc/pots/${pot.potId}/handshake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side: mySide,
          priceYes: other.price_yes,
          notional: other.notional,
          deadline: Number(other.deadline),
          signature: sig,
        }),
      });
    }, "Paws shaken. The pot is split at the agreed price, with no fee.");
  const offerHandshake = () =>
    a.run(async (s) => {
      const p = Math.round(price! * 1e6);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
      const sig = await signHandshake(who.actor!, POTS, pot, p, n, deadline, s);
      return getJson(`/api/hc/pots/${pot.potId}/handshake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side: mySide,
          priceYes: p,
          notional: n.toString(),
          deadline: Number(deadline),
          signature: sig,
        }),
      });
    }, "Offered. The other side can accept for 15 minutes.");

  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 28,
        maxWidth: 760,
      }}
    >
      <AccountLine who={who} />
      <div>
        <NotifyButton potId={pot.potId} account={me} when="change" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>Leave, or shake hands</h2>
        {!ask ? (
          <>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "center",
              }}
            >
              <Button
                disabled={!!a.step || !!blocked}
                onClick={() => setAsk({ amount: n, what: "your whole share" })}
              >
                Leave with my whole share
              </Button>
              {other ? (
                <Button disabled={!!a.step} onClick={acceptHandshake}>
                  Shake hands at {pct(other.price_yes)}
                </Button>
              ) : (
                <Button
                  variant="quiet"
                  disabled={!!a.step || price === null}
                  onClick={offerHandshake}
                >
                  {mineOffer
                    ? `Offer the handshake again at ${price === null ? "…" : (price * 100).toFixed(1)}%`
                    : `Offer a handshake at ${price === null ? "…" : (price * 100).toFixed(1)}%`}
                </Button>
              )}
            </div>
            <p
              style={{
                margin: 0,
                color: C.body,
                fontSize: 16,
                lineHeight: 1.5,
              }}
            >
              <strong>Leaving:</strong> your share is priced over the next 30
              seconds, and you give a treat for the other cat of{" "}
              {$(feeOf(n, Number(d.feeBps)))} (1%). <strong>Handshake:</strong>{" "}
              if both of you agree, the pot splits now at the current price,
              with no fee.{" "}
              <FeeNote
                fees={fees}
                payer={who.actor?.kind === "wallet" ? "wallet" : "honorcat"}
              />
            </p>
            {(other || mineOffer) && (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4 }}>
                <PlayerCat
                  account={me}
                  pose="paw"
                  size={80}
                  label="Your cat holding out a paw"
                />
                <div style={{ transform: "scaleX(-1)" }}>
                  <PlayerCat
                    account={mySide === YES ? pot.owners.no : pot.owners.yes}
                    pose="paw"
                    size={80}
                    label="The other cat holding out a paw"
                  />
                </div>
                <span style={{ fontSize: 15, color: C.body, paddingLeft: 10 }}>
                  {other
                    ? `${nameOf(mySide === YES ? pot.owners.no : pot.owners.yes)} offers to shake hands at ${pct(other.price_yes)}. Accept to split now with no fee.`
                    : `You offered to shake hands at ${pct(mineOffer!.price_yes)}. The other side can accept for 15 minutes.`}
                </span>
              </div>
            )}
            <details>
              <summary
                style={{ cursor: "pointer", fontSize: 16, minHeight: 32 }}
              >
                More ways to leave: part of the pot, one life
              </summary>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 10,
                  alignItems: "flex-end",
                  paddingTop: 12,
                }}
              >
                {ninth > 0n && n > ninth && (
                  <Button
                    variant="quiet"
                    disabled={!!a.step || !!blocked}
                    onClick={() =>
                      setAsk({
                        amount: ninth,
                        what: `one life (${$(ninth)} of the pot)`,
                      })
                    }
                  >
                    Spend one life ({$(ninth)} of the pot)
                  </Button>
                )}
                <label
                  style={{ display: "flex", flexDirection: "column", gap: 4 }}
                >
                  <span style={{ fontSize: 14, color: C.muted }}>
                    Or leave with part of the pot (USDC)
                  </span>
                  <input
                    style={input}
                    inputMode="decimal"
                    value={part}
                    onChange={(e) =>
                      setPart(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                  />
                </label>
                <Button
                  variant="quiet"
                  disabled={
                    !!a.step ||
                    !!blocked ||
                    !(Number(part) > 0) ||
                    BigInt(Math.round(Number(part) * 1e6)) > n
                  }
                  onClick={() =>
                    setAsk({
                      amount: BigInt(Math.round(Number(part) * 1e6)),
                      what: `${money(Math.round(Number(part) * 1e6))} of the pot (a partial exit)`,
                    })
                  }
                >
                  Leave with this part
                </Button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Cat pose="lives" size={180} lives={lives} />
                <span style={{ fontSize: 15, color: C.muted }}>
                  {lives} of 9 ninths left: each one takes a ninth of the
                  starting pot off the rope.
                </span>
              </div>
            </details>
          </>
        ) : (
          (() => {
            const shareOf =
              own === null
                ? null
                : BigInt(Math.floor(Number(ask.amount) * own));
            const fee = feeOf(ask.amount, Number(d.feeBps));
            const est =
              shareOf === null ? null : shareOf > fee ? shareOf - fee : 0n;
            const otherName = nameOf(
              mySide === YES ? pot.owners.no : pot.owners.yes,
            );
            const lines = exitOptions({
              leaveAbout: est === null ? "…" : $(est),
              fee: $(fee),
              pot: $(n),
              mine: st
                ? mySide === YES
                  ? st.yes
                  : st.no
                : "your side happens",
              other: otherName,
              chance:
                price === null
                  ? "the current price"
                  : `${(price * 100).toFixed(1)}%`,
              part: ask.amount < n ? `${$(ask.amount)} of the pot` : null,
            }).filter(adviceFree);
            return (
              <>
                <div
                  role="group"
                  aria-label="Confirm your exit"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    padding: "14px 16px",
                    border: `2px solid ${C.ink}`,
                    maxWidth: 640,
                  }}
                >
                  <strong
                    style={{
                      fontFamily: F.cond,
                      fontSize: 28,
                      fontWeight: 600,
                    }}
                  >
                    Leave with {ask.what}?
                  </strong>
                  <p style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>
                    Estimate: about{" "}
                    <strong>{est === null ? "…" : $(est)}</strong> for you,
                    after a treat for the other cat of <strong>{$(fee)}</strong>
                    .
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 16,
                      lineHeight: 1.5,
                      color: C.body,
                    }}
                  >
                    The final price is the average of the next 30 seconds, not
                    the price you see now, so the amount can differ. Once sent,
                    the request cannot be withdrawn. Someone may take over your
                    side instead; you are then paid the same from them.
                  </p>
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Button
                      busy={!!a.step}
                      onClick={() => {
                        const x = ask;
                        setAsk(null);
                        void a.run(
                          (s) =>
                            requestExit(
                              who.actor!,
                              POTS,
                              pot,
                              mySide,
                              x.amount,
                              s,
                            ),
                          "Exit requested. The cat crouches: the next 30 seconds set the price.",
                        );
                      }}
                    >
                      Yes, leave
                    </Button>
                    <Button variant="quiet" onClick={() => setAsk(null)}>
                      Not now
                    </Button>
                  </div>
                </div>
                <HelperBubble lines={lines} />
              </>
            );
          })()
        )}
        {blocked && <p style={{ margin: 0, color: C.muted }}>{blocked}</p>}
      </div>

      <details style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <summary
          style={{
            cursor: "pointer",
            fontFamily: F.cond,
            fontSize: 28,
            fontWeight: 600,
            minHeight: 40,
          }}
        >
          Net and bowl: leave automatically at a price
        </summary>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          A net catches you if your side&apos;s price falls to it; a bowl takes
          your share off the rope when it rises to it. When the 30-second
          average holds there, the samplers file your exit; it is then priced
          like any other. Now:{" "}
          {lv?.net ? `net ${(lv.net / 10_000).toFixed(1)}%` : "no net"},{" "}
          {lv?.bowl ? `bowl ${(lv.bowl / 10_000).toFixed(1)}%` : "no bowl"}.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (own === null) return;
            const w = readWish(wish, own, Number(n) / 1e6);
            setLevelsHelp(true);
            if (w.kind === "net") setNet(String(w.percent));
            if (w.kind === "bowl") setBowl(String(w.percent));
            setWishNote(
              w.kind === "none"
                ? w.why
                : `${w.why} I filled it in below; nothing is set until you press Save.`,
            );
          }}
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "flex-end",
          }}
        >
          <label
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: "1 1 260px",
            }}
          >
            <span style={{ fontSize: 14, color: C.muted }}>
              Or tell the helper cat what you want
            </span>
            <input
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              maxLength={120}
              placeholder="e.g. protect half my stake"
              style={{ ...input, width: "100%" }}
            />
          </label>
          <Button
            type="submit"
            variant="quiet"
            disabled={!wish.trim() || own === null}
          >
            Fill it in
          </Button>
        </form>
        {levelsHelp && own !== null && (
          <HelperBubble
            pose="point"
            lines={[
              ...(wishNote ? [wishNote] : []),
              ...levelOptions({
                own: own,
                shareNow: $(BigInt(Math.floor(Number(n) * own))),
                net: Number(net) || null,
                bowl: Number(bowl) || null,
              }),
            ].filter(adviceFree)}
          />
        )}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "flex-end",
          }}
        >
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, color: C.muted }}>
              Net at (% for your side)
            </span>
            <input
              style={input}
              inputMode="decimal"
              value={net}
              onFocus={() => setLevelsHelp(true)}
              onChange={(e) => setNet(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 40"
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, color: C.muted }}>Bowl at (%)</span>
            <input
              style={input}
              inputMode="decimal"
              value={bowl}
              onFocus={() => setLevelsHelp(true)}
              onChange={(e) => setBowl(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="e.g. 90"
            />
          </label>
          <Button
            variant="quiet"
            busy={!!a.step}
            disabled={!!levelsBad}
            onClick={() =>
              a.run(
                (s) =>
                  setLevels(
                    who.actor!,
                    POTS,
                    pot,
                    mySide,
                    Math.round((Number(net) || 0) * 10_000),
                    Math.round((Number(bowl) || 0) * 10_000),
                    s,
                  ),
                "Saved. The samplers watch it now.",
              )
            }
          >
            Save
          </Button>
          {levelsBad && (
            <span role="alert" style={{ fontSize: 14, color: C.signalInk, flexBasis: "100%" }}>
              {levelsBad}
            </span>
          )}
        </div>
      </details>

      <Feedback a={a} account={who.actor?.account ?? null} />
    </section>
  );
}

/** Web push for this pot. `when`: what the player is waiting for (an opponent, or any change once the pot runs). */
/* ------------------------------------------------------------------ after an exit */

/**
 * The last division of the pot, in plain words: what each side received, the treat (fee) and the
 * evidence. For a partial exit it says so and shows what remains in the pot.
 */
/** After a payout: send what this pot paid you on to another player, by name. */
function ShareSend({
  pot,
  who,
  mine,
}: {
  pot: HcPot;
  who: ActorState;
  mine: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (mine === null || !who.actor) return null;
  const paid = receiptsOf(
    pot.events ?? [],
    mine,
    () => "",
    () => "",
  ).reduce((n, r) => n + (r.mine ?? 0n), 0n);
  if (paid <= 0n) return null;
  if (!open)
    return (
      <Button
        variant="quiet"
        onClick={() => setOpen(true)}
        style={{ alignSelf: "flex-start" }}
      >
        Send my ${(Number(paid) / 1e6).toFixed(2)} to…
      </Button>
    );
  return (
    <SendTo
      actor={who.actor}
      balance={who.balance}
      amount={paid < (who.balance ?? paid) ? paid : (who.balance ?? paid)}
      potId={pot.potId}
      title="Send my share to a player"
    />
  );
}

function ExitSummary({
  pot,
  nameOf,
  st,
}: {
  pot: HcPot;
  nameOf: (a: string | null) => string;
  st: Sides | null;
}) {
  const ev = pot.events ?? [];
  const idx = ev.map((e) => e.name).lastIndexOf("PotDivided");
  if (idx < 0) return null;
  const e = ev[idx]!;
  const g = e.args;
  let before = 0n;
  for (const x of ev.slice(0, idx)) {
    if (x.name === "PotCreated") before = BigInt(x.args.notional ?? "0");
    if (x.name === "PotDivided" || x.name === "Handshake")
      before -= BigInt(x.args.notional ?? "0");
  }
  const divided = BigInt(g.notional ?? "0");
  const remains = before - divided;
  const partial = remains > 0n && pot.state !== "Divided";
  const exitSide = Number(g.exitSide ?? 0);
  const fee = BigInt(g.fee ?? "0");
  const who = (side: number) =>
    nameOf(side === YES ? pot.owners.yes : pot.owners.no);
  const says = (side: number) =>
    st ? (side === YES ? st.yes : st.no) : side === YES ? "YES" : "NO";
  return (
    <section
      aria-label={partial ? "The last partial exit" : "How the pot ended"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "14px 16px",
        border: `2px solid ${C.ink}`,
        maxWidth: 760,
      }}
    >
      <strong style={{ fontFamily: F.cond, fontSize: 28, fontWeight: 600 }}>
        {partial
          ? `A partial exit: ${$(divided)} of the ${$(before)} pot was divided at ${pct(Number(g.price ?? 0))}`
          : `Divided at ${pct(Number(g.price ?? 0))}`}
      </strong>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 18, lineHeight: 1.5 }}>
        <li>
          {who(YES)} ({says(YES)}) received <strong>{$(g.paidYes ?? 0)}</strong>
        </li>
        <li>
          {who(1)} ({says(1)}) received <strong>{$(g.paidNo ?? 0)}</strong>
        </li>
        <li>
          {who(exitSide)} left and gave {who(1 - exitSide)} a treat for the
          other cat of <strong>{$(fee)}</strong> (the 1% fee), included above.
        </li>
      </ul>
      {partial && (
        <p style={{ margin: 0, fontSize: 18 }}>
          The pot is still live with <strong>{$(remains)}</strong>; both sides
          keep their places for the rest.
        </p>
      )}
      <p style={{ margin: 0, fontSize: 15 }}>
        <Link href={`/pots/${pot.potId}/proof`}>
          See the evidence for this price
        </Link>{" "}
        ·{" "}
        <a href={txUrl(e.tx)} target="_blank" rel="noreferrer">
          the payout on Arc
        </a>
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ the evidence of each window */

function Windows({ pot, tech }: { pot: HcPot; tech: boolean }) {
  const rows = pot.requests.filter((r) => r.kind !== "depth");
  const st = pot.market ? sidesOf(pot.market) : null;
  if (!rows.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={h2}>Every measured price</h2>
      <p
        style={{
          margin: 0,
          color: C.body,
          fontSize: 16,
          lineHeight: 1.5,
          maxWidth: 720,
        }}
      >
        Three samplers read Gemini&apos;s order book on their own and each signs
        its own average. Three valid averages: the middle one counts. Two: their
        mean, if they are within half a point. Otherwise nothing moves.
      </p>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map((r) => {
          const att = r.payload.attestation;
          return (
            <div
              key={r.id}
              style={{
                borderBottom: `1px solid ${C.faint}`,
                padding: "12px 0",
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "4px 16px",
                  alignItems: "baseline",
                }}
              >
                <strong style={{ fontSize: 17 }}>
                  {r.kind === "outcome"
                    ? "Gemini's result"
                    : kindText(r.payload.kind ?? 0, st)}
                </strong>
                {r.payload.windowStart && (
                  <span style={{ color: C.muted, fontSize: 15 }}>
                    {formatDate(r.payload.windowStart * 1000)},{" "}
                    {r.payload.windowEnd! - r.payload.windowStart} s
                  </span>
                )}
                <span style={{ fontSize: 15 }}>
                  {r.kind === "outcome"
                    ? ""
                    : att
                      ? att.valid
                        ? `${(att.priceYes / 10_000).toFixed(2)}% chance${tech ? " (YES price)" : ""} (${r.payload.reason})`
                        : `no price: ${r.payload.reason}`
                      : r.status === "measuring"
                        ? "measuring"
                        : r.status}
                </span>
                {r.tx && (
                  <a
                    href={txUrl(r.tx)}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 15 }}
                  >
                    transaction
                  </a>
                )}
                {r.error && (
                  <span style={{ color: C.signalInk, fontSize: 14 }}>
                    {r.error.slice(0, 120)}
                  </span>
                )}
              </div>
              {r.payload.memo && (
                <span style={{ fontSize: 14, color: C.body }}>
                  Memo on Arc: <em>{r.payload.memo}</em>
                </span>
              )}
              {r.payload.averages && (
                <ul
                  style={{
                    margin: 0,
                    padding: 0,
                    listStyle: "none",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "2px 20px",
                    fontSize: 14,
                    color: C.muted,
                  }}
                >
                  {r.payload.averages.map((x) => (
                    <li key={x.signer}>
                      sampler {short(x.signer)}:{" "}
                      {x.valid
                        ? `${(Number(x.ppm) / 10_000).toFixed(2)}%`
                        : "not enough valid readings"}{" "}
                      ({x.sampleCount} readings)
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ page */

/** Once a pot has ended: what this player got from it, first thing on the page. */
function ResultBanner({ pot, mine }: { pot: HcPot; mine: number }) {
  const receipts = receiptsOf(
    pot.events ?? [],
    mine,
    () => "",
    () => "",
  );
  const got = receipts.reduce((n, r) => n + (r.mine ?? 0n), 0n);
  const refunded = pot.state === "Expired";
  // Ended before anyone joined: the creator cancelled (or the offer ran out), nothing was played.
  const cancelled =
    refunded && !(pot.events ?? []).some((e) => e.name === "Joined");
  // The state can change before the payout's own event is read from Arc: never show $0 for "not yet".
  if (!refunded && receipts.length === 0)
    return (
      <div
        role="status"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "baseline",
          gap: "4px 16px",
          background: C.ink,
          color: C.page,
          padding: "14px 18px",
          maxWidth: 760,
        }}
      >
        <span
          style={{
            fontFamily: F.cond,
            fontSize: 34,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          Paid out
        </span>
        <span style={{ fontSize: 16, color: C.faint }}>
          Your amount appears here in a moment, as soon as the payout is read
          from Arc.
        </span>
      </div>
    );
  return (
    <div
      role="status"
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "4px 16px",
        background: C.ink,
        color: C.page,
        padding: "14px 18px",
        maxWidth: 760,
      }}
    >
      <span
        style={{
          fontFamily: F.cond,
          fontSize: 34,
          fontWeight: 600,
          lineHeight: 1,
        }}
      >
        {cancelled ? "Cancelled" : refunded ? "Refunded" : `You got ${$(got)}`}
      </span>
      <span style={{ fontSize: 16, color: C.faint }}>
        {cancelled
          ? "Nobody joined, so nothing was played. Your money is back in your account."
          : refunded
            ? "Nobody could price this pot; both sides got their money back."
            : "from this pot. The details are below."}
      </span>
    </div>
  );
}

export function PotView({ id }: { id: string }) {
  useHome();
  const who = useActor();
  // A private pot needs the link's key (?k=) or a player's own account.
  const linkKey = useSearchParams().get("k");
  const viewer = who.actor?.account ?? null;
  const potQs = new URLSearchParams({ ...(linkKey ? { k: linkKey } : {}), ...(viewer ? { account: viewer } : {}) }).toString();
  const { data: pot, error } = usePolling<HcPot & { private?: boolean; privateKey?: string | null }>(`/api/hc/pots/${id}${potQs ? `?${potQs}` : ""}`, 3000);
  // A closed pot shows its final state: no live price is read for it.
  const closed = pot ? pot.state === "Divided" || pot.state === "Settled" || pot.state === "Expired" : false;
  const live = useLivePrice(
    closed ? null : (pot?.market?.instrument ?? null),
    Number(pot?.data.window ?? 30),
  );
  const nowS = Math.floor(useNow() / 1000);
  const q = useSearchParams();
  const practiceFailed = q.get("practice") === "failed";
  const botInvited = q.get("bot") === "1";
  const botFailed = q.get("bot") === "failed";
  const { tech } = useTechMode();
  const names = useNames([
    pot?.owners.yes,
    pot?.owners.no,
    pot?.data.joiner,
    ...(pot?.events ?? []).flatMap((e) => [
      e.args.creator,
      e.args.joiner,
      e.args.taker,
      e.args.from,
      e.args.to,
    ]),
  ]);

  if (!pot)
    return error ? (
      <CatState
        kind="error"
        text={
          /404|not found/i.test(error)
            ? `There is no pot ${id}. Check the link, or see all pots.`
            : /private/i.test(error)
              ? "This pot is private: only its players and people with its link can see it."
              : error
        }
      />
    ) : (
      <CatState kind="loading" text="Reading the pot from Arc…" />
    );

  const m = pot.market;
  const me = who.actor?.account ?? null;
  // A perp's rope: both seats are the perps contract's, held for the perp's two players.
  const perpSeat = pot.perp ? pot.owners.yes?.toLowerCase() : null;
  const nameOf = (a: string | null) =>
    perpSeat && a?.toLowerCase() === perpSeat
      ? `Perp ${pot.perp!.perpId}`
      : displayName(a, names, me, tech, a ? "a player" : "open seat");
  const scene = sceneOf(pot, live.smoothed, nowS, { me, names, tech });
  const v2 = Boolean((pot.data as unknown as { v2?: boolean }).v2);
  const story = storyOf(v2 ? asV1Pot(pot) : pot, nameOf);
  const st = m ? sidesOf(m) : null;
  const mine = sideOf(pot, me);
  const expiry = Number(
    (pot.data as unknown as { expiry?: string }).expiry ?? 0,
  );
  const ended =
    pot.state === "Divided" ||
    pot.state === "Settled" ||
    pot.state === "Expired";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 15, color: C.muted }}>
          Pot {pot.potId} · {m ? marketLine(m) : ""} · trading closes{" "}
          {formatDate(Number(pot.data.closeTime) * 1000)}
          {m?.eventTicker && (
            <>
              {" · "}
              <GeminiLink
                ticker={m.eventTicker}
                slug={m.slug}
                label="Trade this market on Gemini"
                size={15}
              />
            </>
          )}
        </span>
        <h1
          style={{
            margin: 0,
            fontFamily: F.cond,
            fontSize: "clamp(34px, 7vw, 56px)",
            fontWeight: 600,
            lineHeight: 0.95,
          }}
        >
          {st ? `${st.yes}?` : "Pot"}
        </h1>
        {pot.perp && (
          <p role="note" style={{ margin: 0, fontSize: 18 }}>
            This is <strong>rope {pot.perp.rope}</strong> of{" "}
            <Link href={`/perps/${pot.perp.perpId}`}>
              perp {pot.perp.perpId}
            </Link>
            . Both seats are held by the perp for its two players; see the perp
            for the players, their lives and every rope.
          </p>
        )}
        {st && (
          <p
            style={{ margin: 0, fontSize: 18, color: C.ink, lineHeight: 1.45 }}
          >
            One side holds <strong>{st.yes}</strong>; the other holds{" "}
            <strong style={{ color: C.signalInk }}>{st.no}</strong>.
            {mine !== null && (
              <>
                {" "}
                You hold <strong>{mine === YES ? st.yes : st.no}</strong>.
              </>
            )}
          </p>
        )}
        {m && tech && (
          <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
            Technical: the first side is YES on Gemini&apos;s contract{" "}
            {m.instrument}, which settles YES if{" "}
            {yesMeans(m).charAt(0).toLowerCase() + yesMeans(m).slice(1)}; the
            second side is NO.
          </p>
        )}
        {pot.practice && (
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
            <strong>Practice pot.</strong> The other side is the practice cat,
            HonorCat&apos;s own test account. It never leaves on its own; you
            can leave whenever you like, or hold until Gemini&apos;s result.
            Test money only.
          </p>
        )}
        {practiceFailed && pot.state === "Open" && (
          <p
            role="alert"
            style={{
              margin: 0,
              fontSize: 17,
              color: C.signalInk,
              maxWidth: 760,
            }}
          >
            The practice cat could not take the other side just now. Your pot is
            open and waits for a real opponent: send the link, or take it back
            below and get your deposit back.
          </p>
        )}
        {botFailed && pot.state === "Open" && (
          <p
            role="alert"
            style={{ margin: 0, fontSize: 17, color: C.signalInk, maxWidth: 760 }}
          >
            Your pot is open, but the invite for your Grok Bot did not go through. Send the link to a
            friend, or take the pot back below and get your deposit back.
          </p>
        )}
        {botInvited && pot.state === "Open" && (
          <p
            role="status"
            style={{ margin: 0, fontSize: 17, maxWidth: 760, lineHeight: 1.5 }}
          >
            Your pot waits for your Grok Bot. Tell it:{" "}
            <strong>“take my HonorCat invite”</strong>. It joins with
            HonorCat&apos;s practice wallet as an AI player (test money, out of
            honor records). <a href="/grok-bot">How to set up your Grok Bot</a>
          </p>
        )}
        <PotStatusLine
          state={pot.state}
          mySide={mine}
          exitSide={
            pot.state === "ExitRequested" ? Number(pot.data.exitSide) : null
          }
          exitFull={
            v2
              ? (pot.data as unknown as { exitSize?: string; size?: string })
                  .exitSize === (pot.data as unknown as { size?: string }).size
              : pot.data.exitNotional === pot.data.notional
          }
          leaverName={nameOf(
            Number(pot.data.exitSide) === 0 ? pot.owners.yes : pot.owners.no,
          )}
          rope={v2 && expiry > 0}
          v2={v2}
        />
        {ended && mine !== null && <ResultBanner pot={pot} mine={mine} />}
        {!pot.practice && !pot.perp && (
          <PlayersHonor
            players={[
              { account: pot.owners.yes, name: nameOf(pot.owners.yes) },
              { account: pot.owners.no, name: nameOf(pot.owners.no) },
            ]}
          />
        )}
        {!pot.practice && !pot.perp && pot.owners.yes && pot.owners.no ? (
          <RivalryLine
            a={pot.owners.yes}
            b={pot.owners.no}
            nameA={nameOf(pot.owners.yes)}
            nameB={nameOf(pot.owners.no)}
          />
        ) : !pot.practice && pot.state === "Open" && me && mine === null ? (
          // A challenge: the visitor's record against the player who opened it.
          <RivalryLine
            a={me}
            b={pot.owners.yes ?? pot.owners.no}
            nameA="you"
            nameB={nameOf(pot.owners.yes ?? pot.owners.no)}
            intro
          />
        ) : null}
      </header>

      <Rope {...scene} trail={live.trail} speed={live.speed} />
      <Watching watchKey={String(pot.potId)} startHref="/pots/new" tvHref={`/pots/${pot.potId}/tv${linkKey ? `?k=${linkKey}` : ""}`} player={mine !== null} />
      {mine !== null && !pot.practice && <PrivateControl potId={String(pot.potId)} who={who} isPrivate={!!pot.private} privateKey={pot.privateKey ?? null} />}
      {(pot.state === "Live" || pot.state === "ExitRequested" || pot.state === "Joining") && !pot.perp && (
        <Reactions potId={String(pot.potId)} />
      )}
      {v2 && expiry > 0 && (
        <ShortRopeNote expiry={expiry} nowS={nowS} ended={ended} />
      )}
      {v2 && (pot.state === "Joining" || pot.state === "Live" || pot.state === "ExitRequested") && (
        <RopePricing expiryTries={Number((pot.data as unknown as { expiryTry?: string }).expiryTry ?? 0)} potId={String(pot.potId)} expiry={expiry} leaving={pot.state === "ExitRequested"} />
      )}

      {!v2 && mine !== null && pot.state === "Live" && (
        <ThreeNumbers pot={pot} side={mine} price={live.smoothed} st={st} />
      )}

      {/* v1 actions call HonorCatPots; v2 pots their own panel. Right under the rope, before any detail. */}
      {v2 ? (
        <>
          <RopeActions
            pot={pot}
            who={who}
            price={live.smoothed}
            nameOf={nameOf}
          />
          <RopeLives pot={pot} who={who} nowS={nowS} />
        </>
      ) : (
        <>
          <Actions
            pot={pot}
            who={who}
            price={live.smoothed}
            nowS={nowS}
            nameOf={nameOf}
          />
          <AgentPanel
            pot={pot}
            who={who}
            agent={(pot as HcPot & { agent?: AgentInfo | null }).agent}
            mySide={mine}
            pots={POTS}
          />
        </>
      )}

      {pot.state !== "Divided" &&
        pot.state !== "Settled" &&
        pot.state !== "Expired" && <SamplerNotice />}

      {(pot.state === "Divided" ||
        pot.state === "Live" ||
        pot.state === "ExitRequested") && (
        <ExitSummary pot={v2 ? asV1Pot(pot) : pot} nameOf={nameOf} st={st} />
      )}

      <Receipts
        events={pot.events ?? []}
        fees={pot.fees ?? {}}
        mySide={mine}
        name={(side) => nameOf(side === 0 ? pot.owners.yes : pot.owners.no)}
        says={(side) =>
          st ? (side === 0 ? st.yes : st.no) : side === 0 ? "YES" : "NO"
        }
        fur={(side) =>
          FURS[furOf(side === 0 ? pot.owners.yes : pot.owners.no)].hex
        }
        livePrice={live.smoothed}
        posts={
          v2
            ? [
                Number((pot.data as unknown as { lower: string }).lower) / 1e6,
                Number((pot.data as unknown as { upper: string }).upper) / 1e6,
              ]
            : [0, 1]
        }
      />
      {!v2 && <ShareSend pot={pot} who={who} mine={mine} />}

      <PriceChart pot={pot} />

      {story.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: F.cond,
              fontSize: 32,
              fontWeight: 600,
            }}
          >
            What happened
          </h2>
          <ol
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              borderTop: `1.5px solid ${C.ink}`,
            }}
          >
            {story.map((s, i) => (
              <li
                key={i}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 16px",
                  padding: "10px 0",
                  borderBottom: `1px solid ${C.faint}`,
                  fontSize: 16,
                  lineHeight: 1.45,
                }}
              >
                <span style={{ color: C.muted, minWidth: 150 }}>
                  {s.at ? formatDate(s.at * 1000) : ""}
                </span>
                <span style={{ flex: "1 1 420px" }}>
                  {s.text}
                  {cents(pot.fees?.[s.tx.toLowerCase()]) && (
                    <span style={{ color: C.muted, fontSize: 14 }}>
                      {" "}
                      Arc fee {cents(pot.fees?.[s.tx.toLowerCase()])}.
                    </span>
                  )}
                </span>
                <a
                  href={txUrl(s.tx)}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: C.muted, fontSize: 14 }}
                >
                  transaction
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(pot.state === "Divided" ||
        pot.state === "Settled" ||
        pot.state === "Expired") && (
        <AfterPot pot={pot} who={who} nameOf={nameOf} />
      )}

      {v2 && (
        <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
          Nothing goes to HonorCat: every fee in this pot goes to a player.
        </p>
      )}
      {m?.eventTicker && st && (
        <GeminiCard
          ticker={m.eventTicker}
          slug={m.slug}
          question={`${st.yes}?`}
          yes={st.yesShort}
          no={st.noShort}
          price={live.smoothed}
        />
      )}
      <RateNote />

      <Windows pot={pot} tech={tech} />

      <nav
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "8px 28px",
          fontSize: 16,
        }}
      >
        <Link href={`/pots/${pot.potId}/tv`}>Big screen</Link>
        <Link href={`/pots/${pot.potId}/terms`}>Terms of this pot</Link>
        <Link href={`/pots/${pot.potId}/proof`}>Proof</Link>
        {pot.createdTx && (
          <a href={txUrl(pot.createdTx)} target="_blank" rel="noreferrer">
            Created on Arc
          </a>
        )}
      </nav>
      <GeminiCredit />
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
        Test version on Arc testnet: test money only. Not financial advice.
      </p>
    </div>
  );
}
