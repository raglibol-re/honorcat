"use client";

import { useState } from "react";
import type { Address } from "viem";
import { C, F } from "@/components/cat/tokens";
import { type useActor } from "@/components/pot/Who";
import { addLife, sideOf, type HcPot } from "@/lib/hc";
import { plainError } from "@/lib/messages";
import { MAX_LIVES, P } from "@/lib/rope";

import { ActionProgress, Button } from "@/components/ui/Button";
import { money } from "@/lib/currency";
const $ = (base: bigint | number | string) => money(base);
const pts = (ppm: number) => (ppm / 10_000).toFixed(0);

/**
 * A short rope's extra lives: the side with a post may pay to move it one rope length further out.
 * The other side's share stays the same or grows at every price, so it never needs the other's consent.
 */
export function RopeLives({
  pot,
  who,
  nowS,
}: {
  pot: HcPot;
  who: ReturnType<typeof useActor>;
  nowS: number;
}) {
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = pot.data as unknown as Record<string, string>;
  const mine = sideOf(pot, who.actor?.account ?? null);
  if (
    pot.state !== "Live" ||
    mine === null ||
    !who.actor ||
    Number(d.expiry ?? 0) === 0
  )
    return null;
  const size = BigInt(d.size ?? "0");
  const lower = Number(d.lower);
  const upper = Number(d.upper);
  const dist = Number(mine === 0 ? d.distYes : d.distNo);
  const lives = Number(mine === 0 ? d.livesYes : d.livesNo);
  const hasPost = dist > 0 && (mine === 0 ? lower > 0 : upper < P);
  if (!hasPost) return null;
  const from = mine === 0 ? lower : upper;
  const to = mine === 0 ? Math.max(0, lower - dist) : Math.min(P, upper + dist);
  const cost =
    BigInt(Math.abs(Math.floor(from / 100) - Math.floor(to / 100))) * size;
  const lockout = Math.max(1 + Number(d.window) + 60, 120);
  const tooLate = nowS + lockout >= Number(d.expiry);
  const left = MAX_LIVES - lives;
  const buy = async () => {
    setErr(null);
    try {
      await addLife(
        who.actor!,
        d.contract as Address,
        pot.potId,
        mine,
        cost,
        setStep,
      );
      setStep(null);
    } catch (e) {
      setErr(plainError(e));
      setStep(null);
    }
  };
  return (
    <section
      aria-label="Extra lives"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: 680,
      }}
    >
      <h2
        style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}
      >
        Extra lives
      </h2>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.5 }}>
        Your post is at {pts(from)}.{" "}
        {left > 0
          ? `You have ${left} extra ${left === 1 ? "life" : "lives"} left; each one is a paw mark by your post.`
          : "You have used all eight extra lives."}
      </p>
      {left > 0 && (
        <>
          <Button
            busy={!!step}
            style={{
              alignSelf: "flex-start",
              opacity: step || tooLate ? 0.6 : 1,
            }}
            disabled={!!step || tooLate}
            onClick={buy}
          >
            {`Move my post to ${pts(to)} for ${$(cost)}`}
          </Button>
          <ActionProgress step={step} />
          <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
            {tooLate
              ? "Too close to the rope's end for an extra life."
              : "Your opponent's share stays the same or grows at every price, so they do not need to agree. Not while a price window is open."}
          </p>
        </>
      )}
      {err && (
        <p role="alert" style={{ margin: 0, color: C.signalInk }}>
          {err}
        </p>
      )}
    </section>
  );
}
