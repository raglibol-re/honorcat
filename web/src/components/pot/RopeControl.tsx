"use client";

import { useEffect, useState } from "react";
import { useNow } from "@/lib/useNow";
import { C, F } from "@/components/cat/tokens";

import { countdown, expiryChoices, leverageSteps, ropeFor, ropeWords, type RopeChoice } from "@/lib/rope";

import { Button } from "@/components/ui/Button";
import { money } from "@/lib/currency";
const $ = (base: bigint | number | string) => money(base);

export type RopeSetting = { choice: RopeChoice; expiry: number | null };

/**
 * The leverage control on the create page: a shorter rope for the chooser's side, in plain words
 * ("A 10-point move doubles your stake", "You can lose your whole stake if the price falls to 40"),
 * the expiry, and the warning that a short rope ends sooner. 1× is a normal pot, unchanged.
 */
export function RopeControl(o: {
  side: 0 | 1;
  center: number;
  tolerance: number;
  stake: bigint;
  spread: number;
  crypto: boolean;
  closeMs: number;
  /** When the event itself starts (a game), if known: a rope still open then is jumpy. */
  startMs?: number | null;
  sideName: string;
  onChange: (s: RopeSetting) => void;
}) {
  const steps = leverageSteps({ side: o.side, center: o.center, tolerance: o.tolerance, spread: o.spread, crypto: o.crypto });
  const [lev, setLev] = useState(1);
  const nowS = Math.floor(useNow() / 1000); // 0 until the clock starts on the client
  const expiries = nowS ? expiryChoices(nowS, Math.floor(o.closeMs / 1000)) : [];
  const [expIdx, setExpIdx] = useState(0);
  const leverage = steps.includes(lev) && expiries.length ? lev : 1;
  const choice = ropeFor(o.side, o.center, o.stake, leverage);
  const expiry = leverage > 1 ? (expiries[Math.min(expIdx, expiries.length - 1)]?.at ?? null) : null;
  const words = ropeWords(o.side, choice, o.sideName);
  const jumpy = expiry !== null && o.startMs != null && o.startMs / 1000 < expiry;
  const { onChange } = o;
  useEffect(() => onChange({ choice, expiry }), [choice.leverage, choice.size, choice.distance, expiry, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 12 }}>
      <legend style={{ fontSize: 15, fontWeight: 600, color: C.ink, marginBottom: 6 }}>How long is your rope?</legend>
      <div role="radiogroup" aria-label="Leverage" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {steps.map((l) => (
          <Button
            key={l}
            role="radio"
            aria-checked={leverage === l}
            onClick={() => setLev(l)}
            style={{ minHeight: 48, minWidth: 72, padding: "0 14px", background: leverage === l ? C.ink : "transparent", color: leverage === l ? C.page : C.ink, border: `1.5px solid ${C.ink}` }}
          >
            {l === 1 ? "Normal" : `${l}×`}
          </Button>
        ))}
      </div>
      {nowS > 0 && !expiries.length && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>This market closes too soon for a short rope: short ropes must end 2 hours before trading closes.</p>}
      {leverage > 1 && (
        <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: 8, borderLeft: `3px solid ${C.signal}`, paddingLeft: 14 }}>
          <p style={{ margin: 0, fontSize: 20, lineHeight: 1.4, fontFamily: F.sans }}>
            <strong>{words.doubles!.split(":")[0]}.</strong>
          </p>
          <p style={{ margin: 0, fontSize: 18, lineHeight: 1.45 }}>{words.loseAll}</p>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.body }}>
            You put in {$(choice.mine)}, your opponent {$(choice.theirs)}; the pot is {$(choice.pot)}. Nobody can lose more than they put in, and nobody owes anything.
          </p>
          <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>The rope ends at the latest</span>
            <select value={Math.min(expIdx, expiries.length - 1)} onChange={(e) => setExpIdx(Number(e.target.value))} style={{ minHeight: 48, fontSize: 17, border: `1.5px solid ${C.ink}`, background: C.page, color: C.ink, padding: "0 10px" }}>
              {expiries.map((x, i) => (
                <option key={x.at} value={i}>
                  in {x.label} ({countdown(x.at, nowS)})
                </option>
              ))}
            </select>
          </label>
          <p role="note" style={{ margin: 0, fontSize: 16, lineHeight: 1.5, border: `2px solid ${C.ink}`, padding: "10px 12px" }}>
            <strong>A short rope ends sooner.</strong> It ends when the price holds at your post, or at the latest at the time you pick here, at the price then. It never waits for
            Gemini&apos;s result. You can buy an extra life on its page to move your post further out.
          </p>
          {jumpy && (
            <p role="note" style={{ margin: 0, fontSize: 16, lineHeight: 1.5, color: C.signalInk }}>
              <strong>Jumpy:</strong> this game starts before your rope ends. Scores move prices in jumps, and a jump can carry the price past your post at once.
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

/** On a short rope's page: the countdown to its expiry and what that means. */
export function ShortRopeNote({ expiry, nowS, ended }: { expiry: number; nowS: number; ended: boolean }) {
  if (ended) return null;
  const past = nowS >= expiry;
  return (
    <p role="note" aria-live="polite" style={{ margin: 0, fontSize: 17, lineHeight: 1.5, border: `2px solid ${C.ink}`, padding: "10px 14px" }}>
      <strong>Short rope:</strong>{" "}
      {past
        ? "its time is up: the samplers are measuring the closing price, and the pot is divided at it (no fee)."
        : `ends in ${countdown(expiry, nowS)} at the latest, at the price then, or sooner if the price holds at a post. It never waits for Gemini's result.`}
    </p>
  );
}

/** Said on the landing page and on every pot. */
export function NoHouse() {
  return <span>Nothing goes to HonorCat: every fee goes to a player.</span>;
}
