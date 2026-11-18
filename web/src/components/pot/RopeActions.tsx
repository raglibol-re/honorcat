"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";
import { C, F } from "@/components/cat/tokens";
import { btn, btnQuiet, SignIn, type useActor } from "@/components/pot/Who";
import { cancelRope, exitRope, joinRope, ropeJoinEscrow, sideOf, type HcPot } from "@/lib/hc";
import { plainError } from "@/lib/messages";
import { ropeShares } from "@/lib/rope";

const $ = (base: bigint) => `$${(Number(base) / 1e6).toFixed(2)}`;
const pts = (ppm: number) => (ppm / 10_000).toFixed(0);

/**
 * The actions on a HonorCat v2 pot: join an open offer, take back your own, leave (all or half),
 * and copy a side of someone else's pot. Every call goes to HonorCatRopes.
 */
export function RopeActions({ pot, who, price, nameOf }: { pot: HcPot; who: ReturnType<typeof useActor>; price: number | null; nameOf: (a: string | null) => string }) {
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = pot.data as unknown as Record<string, string> & { copies?: ({ leader: string } | null)[] };
  const ropes = d.contract as Address;
  const me = who.actor?.account ?? null;
  const mine = sideOf(pot, me);
  const run = async (f: () => Promise<unknown>) => {
    setErr(null);
    try {
      await f();
      setStep(null);
    } catch (e) {
      setErr(plainError(e));
      setStep(null);
    }
  };
  const box = { display: "flex", flexDirection: "column" as const, gap: 10, maxWidth: 680 };
  const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;
  const errLine = err && (
    <p role="alert" style={{ margin: 0, color: C.signalInk }}>
      {err}
    </p>
  );
  const copies = (d.copies ?? []).map((c, side) => c && <p key={side} style={{ margin: 0, fontSize: 15, color: C.muted }}>{`${side === 0 ? "YES" : "NO"} copies ${nameOf(c.leader)}: if it ends with a profit, 5% of that profit goes to them. No profit, no treat.`}</p>);

  if (pot.state === "Open") {
    const creatorSide = Number(d.creatorSide);
    const creator = creatorSide === 0 ? pot.owners.yes : pot.owners.no;
    if (me && creator && me.toLowerCase() === creator.toLowerCase())
      return (
        <section style={box}>
          <h2 style={h2}>Your offer</h2>
          <button type="button" style={{ ...btnQuiet, alignSelf: "flex-start" }} disabled={!!step} onClick={() => run(() => cancelRope(who.actor!, ropes, pot, setStep))}>
            {step ?? "Take back my offer"}
          </button>
          {errLine}
        </section>
      );
    if (!who.actor) return <SignIn who={who} purpose="Sign in to take the other side." />;
    const esc = ropeJoinEscrow(pot);
    const side = 1 - creatorSide;
    const post = Number(side === 0 ? d.distYes : d.distNo) > 0;
    return (
      <section style={box}>
        <h2 style={h2}>Take the other side</h2>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5 }}>
          You put in at most {$(esc.deposit)}, plus a {$(esc.treat)} maker treat (0.25%) to {nameOf(creator)}, who opened the pot. Anything above your share at the entry price comes back at once.
        </p>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>
          {post ? "Your side has its own post: past it the rope ends and you get nothing more and lose nothing more." : "Your side has no post: you can never lose more than you put in, and the rope ends early if the price reaches the other side's post."}
        </p>
        <button type="button" style={{ ...btn, alignSelf: "flex-start" }} disabled={!!step} onClick={() => run(() => joinRope(who.actor!, ropes, pot, 0n, setStep))}>
          {step ?? "Give your word and join"}
        </button>
        {copies}
        {errLine}
      </section>
    );
  }

  if (pot.state !== "Live") return copies.some(Boolean) ? <section style={box}>{copies}</section> : null;

  if (mine === null) {
    // Someone else's running pot: copy one of its sides in a new pot on the same market.
    const sym = pot.market?.instrument;
    return (
      <section style={box}>
        <h2 style={h2}>Copy a side</h2>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>Start your own pot on the same question and side. If you end with a profit, 5% of it goes to the player you copy; no profit, no treat.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {[0, 1].map((s) => (
            <Link key={s} href={`/pots/new?copy=${BigInt(d.chainPotId) * 2n + BigInt(s)}&pot=${pot.potId}&side=${s}${sym ? `&symbol=${encodeURIComponent(sym)}` : ""}`} style={{ ...btnQuiet, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
              Copy {nameOf(s === 0 ? pot.owners.yes : pot.owners.no)} ({s === 0 ? "YES" : "NO"})
            </Link>
          ))}
        </div>
        {copies}
      </section>
    );
  }

  const size = BigInt(d.size);
  const half = size / 2n;
  const est = (n: bigint) => {
    if (price === null) return null;
    const s = ropeShares(n, Math.round(price * 1e6), Number(d.lower), Number(d.upper));
    const cash = mine === 0 ? s.yes : s.no;
    const fee = (s.total * 100n) / 10_000n;
    return cash > fee ? cash - fee : 0n;
  };
  return (
    <section style={box}>
      <h2 style={h2}>Leave</h2>
      <p style={{ margin: 0, fontSize: 16, color: C.body }}>
        Your exit is priced over the next 30 seconds and clamped to the posts ({pts(Number(d.lower))} to {pts(Number(d.upper))}). You give 1% of the pot value you take out to the other side.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button type="button" style={btn} disabled={!!step} onClick={() => run(() => exitRope(who.actor!, ropes, pot, mine, size, setStep))}>
          {step ?? `Leave now${est(size) !== null ? ` (about ${$(est(size)!)})` : ""}`}
        </button>
        {half > 0n && (
          <button type="button" style={btnQuiet} disabled={!!step} onClick={() => run(() => exitRope(who.actor!, ropes, pot, mine, half, setStep))}>
            Leave half{est(half) !== null ? ` (about ${$(est(half)!)})` : ""}
          </button>
        )}
      </div>
      {copies}
      {errLine}
    </section>
  );
}
