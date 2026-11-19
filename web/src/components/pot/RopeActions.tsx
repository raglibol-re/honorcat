"use client";

import { useState } from "react";
import type { Address } from "viem";
import { C, F } from "@/components/cat/tokens";
import { SignIn, type useActor } from "@/components/pot/Who";
import { Invite } from "@/components/pot/Invite";
import { ActionProgress, Button, ButtonLink } from "@/components/ui/Button";
import { Notice } from "@/components/ui/Field";
import {
  cancelRope,
  exitRope,
  joinRope,
  ropeJoinEscrow,
  sideOf,
  type HcPot,
} from "@/lib/hc";
import { money } from "@/lib/currency";
import { sidesOf } from "@/lib/marketName";
import { ropeShares } from "@/lib/rope";
import { useAction } from "@/lib/useAction";

const pts = (ppm: number) => (ppm / 10_000).toFixed(0);
const box = {
  display: "flex",
  flexDirection: "column" as const,
  gap: 12,
  maxWidth: 680,
};
const h2 = {
  margin: 0,
  fontFamily: F.cond,
  fontSize: 32,
  fontWeight: 600,
} as const;
const row = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap" as const,
  alignItems: "center",
};

/**
 * The actions on a HonorCat v2 pot: invite to or take back an open offer, join it, leave (all or
 * half, after one confirmation), and copy a side of someone else's pot. Every call goes to
 * HonorCatRopes; each button shows its steps under it and confirms when done.
 */
export function RopeActions({
  pot,
  who,
  price,
  nameOf,
}: {
  pot: HcPot;
  who: ReturnType<typeof useActor>;
  price: number | null;
  nameOf: (a: string | null) => string;
}) {
  const a = useAction();
  const [ask, setAsk] = useState<{ size: bigint; what: string } | null>(null);
  const d = pot.data as unknown as Record<string, string> & {
    copies?: ({ leader: string } | null)[];
  };
  const ropes = d.contract as Address;
  const me = who.actor?.account ?? null;
  const mine = sideOf(pot, me);
  const st = pot.market ? sidesOf(pot.market) : null;
  const sideName = (s: number) =>
    st ? (s === 0 ? st.yesShort : st.noShort) : s === 0 ? "YES" : "NO";
  const error = a.error && (
    <p role="alert" style={{ margin: 0, color: C.signalInk }}>
      {a.error}
    </p>
  );
  const copies = (d.copies ?? []).map(
    (c, side) =>
      c && (
        <p key={side} style={{ margin: 0, fontSize: 15, color: C.muted }}>
          {`“${sideName(side)}” copies ${nameOf(c.leader)}: if it ends with a profit, 5% of that profit goes to them. No profit, no treat.`}
        </p>
      ),
  );

  if (pot.state === "Open") {
    const creatorSide = Number(d.creatorSide);
    const creator = creatorSide === 0 ? pot.owners.yes : pot.owners.no;
    if (me && creator && me.toLowerCase() === creator.toLowerCase())
      return (
        <section style={box}>
          <h2 style={h2}>Invite someone</h2>
          <p style={{ margin: 0, fontSize: 17, color: C.body }}>
            Send this page to the person who takes “{sideName(1 - creatorSide)}
            ”. They join with a passkey; nobody pays network fees.
          </p>
          <Invite
            path={`/pots/${pot.potId}`}
            text={`Take the other side of my HonorCat pot${st ? `: ${st.yes}?` : ""}`}
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
                busy={a.isBusy("cancel")}
                disabled={a.any}
                onClick={() =>
                  a.run(
                    "cancel",
                    (s) => cancelRope(who.actor!, ropes, pot, s),
                    "Cancelled. Your money is back in your account.",
                  )
                }
              >
                Cancel and get my money back
              </Button>
              <ActionProgress step={a.step} />
            </div>
          </div>

          {error}
        </section>
      );
    if (!who.actor)
      return <SignIn who={who} purpose="Sign in to take the other side." />;
    const esc = ropeJoinEscrow(pot);
    const side = 1 - creatorSide;
    return (
      <section style={box}>
        <h2 style={h2}>Take “{sideName(side)}”</h2>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5 }}>
          You put in at most <strong>{money(esc.deposit)}</strong>, plus a{" "}
          {money(esc.treat)} maker treat for {nameOf(creator)}. Anything above
          your share at the entry price comes back at once.
        </p>
        <div style={row}>
          <Button
            busy={a.isBusy("join")}
            disabled={a.any}
            onClick={() =>
              a.run(
                "join",
                (s) => joinRope(who.actor!, ropes, pot, 0n, s),
                "You joined. The entry price is measured over the next 30 seconds.",
              )
            }
          >
            Give your word and join
          </Button>
          <ActionProgress step={a.step} />
        </div>
        {copies}
        {error}
      </section>
    );
  }

  // A perp's rope: both seats belong to the perps contract; the players act on the perp's page.
  if (pot.perp)
    return (
      <section style={box}>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>
          This is rope {pot.perp.rope} of perp {pot.perp.perpId}. Leave, add lives or stop renewing on the
          perp&apos;s page.
        </p>
        <div style={row}>
          <ButtonLink href={`/perps/${pot.perp.perpId}`}>Go to perp {pot.perp.perpId}</ButtonLink>
        </div>
      </section>
    );

  if (pot.state !== "Live")
    return copies.some(Boolean) ? (
      <section style={box}>{copies}</section>
    ) : null;

  if (mine === null && !who.actor)
    return (
      <section style={box}>
        <SignIn who={who} purpose="Sign in to see your side's options, or to copy a side." />
      </section>
    );

  if (mine === null) {
    // Someone else's running pot: copy one of its sides in a new pot on the same market.
    const sym = pot.market?.instrument;
    return (
      <section style={box}>
        <h2 style={h2}>Copy a side</h2>
        <p style={{ margin: 0, fontSize: 16, color: C.body }}>
          Start your own pot on the same question and side. If you end with a
          profit, 5% of it goes to the player you copy; no profit, no treat.
        </p>
        <div style={row}>
          {[0, 1].map((s) => (
            <ButtonLink
              key={s}
              variant="quiet"
              href={`/pots/new?copy=${BigInt(d.chainPotId) * 2n + BigInt(s)}&pot=${pot.potId}&side=${s}${sym ? `&symbol=${encodeURIComponent(sym)}` : ""}`}
            >
              Copy {nameOf(s === 0 ? pot.owners.yes : pot.owners.no)} (“
              {sideName(s)}”)
            </ButtonLink>
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
    const s = ropeShares(
      n,
      Math.round(price * 1e6),
      Number(d.lower),
      Number(d.upper),
    );
    const cash = mine === 0 ? s.yes : s.no;
    const fee = (s.total * 100n) / 10_000n;
    return cash > fee ? cash - fee : 0n;
  };
  const about = (n: bigint) =>
    est(n) !== null ? ` (about ${money(est(n)!)})` : "";
  return (
    <section style={box}>
      <h2 style={h2}>Leave</h2>
      {ask ? (
        <Notice tone="warning">
          <strong>
            Leave {ask.what}
            {about(ask.size)}?
          </strong>
          <span>
            The price is the average of the next 30 seconds, held between the
            posts ({pts(Number(d.lower))} to {pts(Number(d.upper))}). You give
            1% of what you take out to the other side.
          </span>
          <div style={{ ...row, marginTop: 8 }}>
            <Button
              busy={a.isBusy("exit")}
              disabled={a.any}
              onClick={async () => {
                const r = await a.run(
                  "exit",
                  (s) => exitRope(who.actor!, ropes, pot, mine, ask.size, s),
                  "Your exit is being priced. The money arrives in about a minute.",
                );
                if (r) setAsk(null);
              }}
            >
              Yes, leave {ask.what}
            </Button>
            <Button
              variant="quiet"
              disabled={a.any}
              onClick={() => setAsk(null)}
            >
              Keep playing
            </Button>
            <ActionProgress step={a.step} />
          </div>
        </Notice>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: 16, color: C.body }}>
            Leave at the market price whenever you like. You give 1% of what you
            take out to the other side.
          </p>
          <div style={row}>
            <Button onClick={() => setAsk({ size, what: "now" })}>
              Leave now{about(size)}
            </Button>
            {half > 0n && (
              <Button
                variant="quiet"
                onClick={() => setAsk({ size: half, what: "with half" })}
              >
                Leave half{about(half)}
              </Button>
            )}
          </div>
        </>
      )}
      {copies}
      {error}
    </section>
  );
}
