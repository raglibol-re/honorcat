"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { Cat } from "@/components/cat/Cat";
import { GeminiCredit } from "@/components/cat/Markets";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { SamplerNotice } from "@/components/pot/SamplerHealth";
import { sceneOf, STATE_TEXT, storyOf } from "@/components/pot/scene";
import { useTechMode } from "@/components/TechMode";
import { marketLine, marketTitle, yesMeans } from "@/lib/marketName";
import { displayName, useNames } from "@/lib/names";
import { useLivePrice } from "@/components/pot/usePrice";
import { AccountLine, FundsHelp, btn, btnQuiet, SignIn, useActor, type ActorState } from "@/components/pot/Who";
import { getJson, usePolling } from "@/lib/api";
import { txUrl } from "@/lib/chain";
import { formatDate, short } from "@/lib/format";
import { cancelPot, feeOf, joinPot, requestExit, setLevels, sideOf, signHandshake, takeover, worstCase, YES, type HcPot } from "@/lib/hc";
import { useNow } from "@/lib/useNow";
import { notifyMe, pushSupported } from "@/lib/push";

const POTS = "0xc890C990048f45cb268d076E4A3dB25270Ea1e59" as const;
const h2: React.CSSProperties = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 };
const input: React.CSSProperties = { minHeight: 44, padding: "0 10px", border: `1.5px solid ${C.ink}`, background: C.page, fontFamily: F.sans, fontSize: 17, color: C.ink, width: 120, boxSizing: "border-box" };
const $ = (base: bigint | string | number) => `$${(Number(base) / 1e6).toFixed(2)}`;
const KIND_TEXT = ["Entry price", "Exit price", "YES net", "NO net", "YES bowl", "NO bowl", "Quote (fair value, moves no money)"];

function useAction() {
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const run = async (f: (s: (x: string) => void) => Promise<{ tx?: string } | unknown>, ok: string) => {
    setErr(null);
    setDone(null);
    try {
      setStep("Preparing");
      await f(setStep);
      setDone(ok);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setStep(null);
    }
  };
  return { step, err, done, run };
}

function Feedback({ a, account }: { a: ReturnType<typeof useAction>; account?: string | null }) {
  return (
    <>
      {a.err?.startsWith("Could not add test money") && account && <FundsHelp account={account} reason={a.err.replace(/^Could not add test money: /, "")} />}
      {a.step && <p style={{ margin: 0, color: C.body }} aria-live="polite">{a.step}…</p>}
      {a.done && <p style={{ margin: 0, color: C.ink }} aria-live="polite">{a.done}</p>}
      {a.err && <p role="alert" style={{ margin: 0, color: C.signalInk }}>{a.err}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ actions by role */

function Actions({ pot, who, price, nowS }: { pot: HcPot; who: ActorState; price: number | null; nowS: number }) {
  const a = useAction();
  const me = who.actor?.account ?? null;
  const mySide = sideOf(pot, me);
  const d = pot.data;
  const n = BigInt(d.notional);
  const creatorSide = Number(d.creatorSide);
  const isCreator = mySide === creatorSide;
  const [part, setPart] = useState("");
  const [net, setNet] = useState("");
  const [bowl, setBowl] = useState("");
  const offers = usePolling<{ offers: { side: number; price_yes: number; notional: string; deadline: string }[] }>(pot.state === "Live" ? `/api/hc/pots/${pot.potId}/handshake` : null, 5000);
  const lockout = Math.max(120, 1 + Number(d.window) + 60);
  const tooLate = nowS + lockout >= Number(d.closeTime);

  if (pot.state === "Open") {
    if (isCreator)
      return (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Invite someone</h2>
          <p style={{ margin: 0, color: C.body, fontSize: 17 }}>Send this page to the person who takes the other side. They join with a passkey or a wallet; nobody pays network fees.</p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <button
              type="button"
              style={btn}
              onClick={async () => {
                const url = location.href.split("?")[0]!;
                const text = `Take the other side of my HonorCat pot${pot.market ? ` on ${pot.market.eventTitle}: ${pot.market.label}` : ""}`;
                if (navigator.share) await navigator.share({ title: "HonorCat pot", text, url }).catch(() => {});
                else await navigator.clipboard?.writeText(url);
              }}
            >
              Share the invite
            </button>
            <button type="button" style={btnQuiet} onClick={() => navigator.clipboard?.writeText(location.href.split("?")[0]!)}>
              Copy the link
            </button>
            <NotifyButton potId={pot.potId} account={me} />
            <button type="button" style={btnQuiet} disabled={!!a.step} onClick={() => who.actor && a.run((s) => cancelPot(who.actor!, POTS, pot, s), "Cancelled: your deposit is back.")}>
              Take the offer back
            </button>
          </div>
          <Feedback a={a} account={who.actor?.account ?? null} />
        </section>
      );
    const side = 1 - creatorSide;
    const dep = worstCase(side, n, Number(d.bandCenter), Number(d.tolerance));
    return (
      <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680 }}>
        <h2 style={h2}>Take the {side === YES ? "YES" : "NO"} side</h2>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          You put in up to <strong>{$(dep)}</strong>. Your starting share is set by the 30-second average price right after you join (it must stay within{" "}
          {(Number(d.tolerance) / 10_000).toFixed(1)} points of {(Number(d.bandCenter) / 10_000).toFixed(1)}%); the rest comes straight back. If the samplers cannot agree on a price, you get everything back.
        </p>
        {!who.actor ? (
          <SignIn who={who} purpose="Your account holds your side. A passkey on this device is enough." />
        ) : (
          <>
            <AccountLine who={who} />
            <button type="button" style={{ ...btn, alignSelf: "flex-start" }} disabled={!!a.step || tooLate} onClick={() => a.run((s) => joinPot(who.actor!, POTS, pot, s), "Joined. The entry price is being measured.")}>
              {tooLate ? "Too close to the market's close" : `Join with ${$(dep)}`}
            </button>
          </>
        )}
        <Feedback a={a} account={who.actor?.account ?? null} />
      </section>
    );
  }

  if (pot.state === "ExitRequested") {
    const full = d.exitNotional === d.notional;
    const end = Number(d.requestTime) + 1 + Number(d.window);
    if (mySide === null && full && d.joiner === "0x0000000000000000000000000000000000000000" && nowS < end)
      return (
        <section style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680 }}>
          <h2 style={h2}>Take over the {Number(d.exitSide) === YES ? "YES" : "NO"} side</h2>
          <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
            You put in {$(n)}. The leaving side is paid its share at the exit price from you instead of from the pot, and you hold its place; the rest of your deposit comes back. If the
            exit price cannot be measured, you get everything back.
          </p>
          {!who.actor ? (
            <SignIn who={who} purpose="Your account will hold the side you take over." />
          ) : (
            <button type="button" style={{ ...btn, alignSelf: "flex-start" }} disabled={!!a.step} onClick={() => a.run((s) => takeover(who.actor!, POTS, pot, s), "Offer in. It completes at the exit price.")}>
              Take over with {$(n)}
            </button>
          )}
          <Feedback a={a} account={who.actor?.account ?? null} />
        </section>
      );
    return null;
  }

  if (pot.state !== "Live" || mySide === null) {
    if (pot.state === "Live" && !who.actor) return <SignIn who={who} purpose="Sign in to see your side's options." />;
    return null;
  }

  const own = price === null ? null : mySide === YES ? price : 1 - price;
  const share = own === null ? null : BigInt(Math.floor(Number(n) * own));
  const initial = BigInt((d as { initialNotional?: string }).initialNotional ?? d.notional);
  const ninth = initial / 9n;
  const lives = initial > 0n ? Math.max(0, Math.min(9, Math.round((9 * Number(n)) / Number(initial)))) : 9;
  const cooldown = nowS < Number(d.cooldownUntil);
  const blocked = tooLate ? "Exits are closed in the last minutes before the market's close." : cooldown ? `A failed exit window just ended; try again in ${Number(d.cooldownUntil) - nowS} s.` : null;
  const other = offers.data?.offers.find((o) => o.side !== mySide);
  const mineOffer = offers.data?.offers.find((o) => o.side === mySide);
  const lv = d.levels?.[mySide];

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 28, maxWidth: 760 }}>
      <AccountLine who={who} />
      <div>
        <NotifyButton potId={pot.potId} account={me} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={h2}>Leave now</h2>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          Your share is about <strong>{share === null ? "…" : $(share)}</strong> at the current average. Leaving is binding: the exit price is the 30-second average starting at your request, not the
          price you see now. You pay a {Number(d.feeBps) / 100}% fee ({$(feeOf(n, Number(d.feeBps)))}) to the other side. Someone else may take over your side instead.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <button type="button" style={btn} disabled={!!a.step || !!blocked} onClick={() => a.run((s) => requestExit(who.actor!, POTS, pot, mySide, n, s), "Exit requested. The exit price is being measured.")}>
            Leave with my whole share
          </button>
          {ninth > 0n && n > ninth && (
            <button type="button" style={btnQuiet} disabled={!!a.step || !!blocked} onClick={() => a.run((s) => requestExit(who.actor!, POTS, pot, mySide, ninth, s), "One life spent. A ninth is being divided.")}>
              Spend one life ({$(ninth)} of the pot)
            </button>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Cat pose="lives" size={180} lives={lives} />
          <span style={{ fontSize: 15, color: C.muted }}>{lives} of 9 lives left: each life divides a ninth of the starting pot.</span>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, color: C.muted }}>Or divide part of the pot (USDC)</span>
            <input style={input} inputMode="decimal" value={part} onChange={(e) => setPart(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <button
            type="button"
            style={btnQuiet}
            disabled={!!a.step || !!blocked || !(Number(part) > 0) || BigInt(Math.round(Number(part) * 1e6)) > n}
            onClick={() => a.run((s) => requestExit(who.actor!, POTS, pot, mySide, BigInt(Math.round(Number(part) * 1e6)), s), "Partial exit requested.")}
          >
            Divide this part
          </button>
        </div>
        {blocked && <p style={{ margin: 0, color: C.muted }}>{blocked}</p>}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={h2}>Net and bowl</h2>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          A net catches you if your side&apos;s price falls to it; a bowl takes your share off the rope when it rises to it. When the 30-second average holds there, the samplers file your exit; it is then priced
          like any other. Now: {lv?.net ? `net ${(lv.net / 10_000).toFixed(1)}%` : "no net"}, {lv?.bowl ? `bowl ${(lv.bowl / 10_000).toFixed(1)}%` : "no bowl"}.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, color: C.muted }}>Net at (% for your side)</span>
            <input style={input} inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 40" />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, color: C.muted }}>Bowl at (%)</span>
            <input style={input} inputMode="decimal" value={bowl} onChange={(e) => setBowl(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="e.g. 90" />
          </label>
          <button
            type="button"
            style={btnQuiet}
            disabled={!!a.step}
            onClick={() => a.run((s) => setLevels(who.actor!, POTS, pot, mySide, Math.round((Number(net) || 0) * 10_000), Math.round((Number(bowl) || 0) * 10_000), s), "Saved. The samplers watch it now.")}
          >
            Save
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h2 style={h2}>Shake hands</h2>
        <p style={{ margin: 0, color: C.body, fontSize: 17, lineHeight: 1.5 }}>
          Both of you agree to divide the pot now at the current average, with no fee and no waiting for a measurement.
        </p>
        {other ? (
          <button
            type="button"
            style={{ ...btn, alignSelf: "flex-start" }}
            disabled={!!a.step}
            onClick={() =>
              a.run(async (s) => {
                const sig = await signHandshake(who.actor!, POTS, pot, other.price_yes, BigInt(other.notional), BigInt(other.deadline), s);
                return getJson(`/api/hc/pots/${pot.potId}/handshake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ side: mySide, priceYes: other.price_yes, notional: other.notional, deadline: Number(other.deadline), signature: sig }) });
              }, "Hands shaken. The pot is divided.")
            }
          >
            Accept: divide at {(other.price_yes / 10_000).toFixed(1)}% YES
          </button>
        ) : (
          <button
            type="button"
            style={{ ...btnQuiet, alignSelf: "flex-start" }}
            disabled={!!a.step || price === null}
            onClick={() =>
              a.run(async (s) => {
                const p = Math.round(price! * 1e6);
                const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60);
                const sig = await signHandshake(who.actor!, POTS, pot, p, n, deadline, s);
                return getJson(`/api/hc/pots/${pot.potId}/handshake`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ side: mySide, priceYes: p, notional: n.toString(), deadline: Number(deadline), signature: sig }) });
              }, "Offered. The other side can accept for 15 minutes.")
            }
          >
            {mineOffer ? `Offered at ${(mineOffer.price_yes / 10_000).toFixed(1)}%. Offer again at ${price === null ? "…" : (price * 100).toFixed(1)}%` : `Offer to divide at ${price === null ? "…" : (price * 100).toFixed(1)}% YES`}
          </button>
        )}
      </div>
      <Feedback a={a} account={who.actor?.account ?? null} />
    </section>
  );
}

function NotifyButton({ potId, account }: { potId: string; account: string | null }) {
  const [state, setState] = useState<"idle" | "busy" | "on" | string>("idle");
  if (!pushSupported()) return null;
  return (
    <button
      type="button"
      style={btnQuiet}
      disabled={state === "busy" || state === "on"}
      onClick={async () => {
        setState("busy");
        try {
          await notifyMe(potId, account);
          setState("on");
        } catch (e) {
          setState((e as Error).message);
        }
      }}
    >
      {state === "on" ? "You will be notified" : state === "idle" || state === "busy" ? "Notify me when someone joins" : state}
    </button>
  );
}

/* ------------------------------------------------------------------ the evidence of each window */

function Windows({ pot }: { pot: HcPot }) {
  const rows = pot.requests.filter((r) => r.kind !== "depth");
  if (!rows.length) return null;
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={h2}>Every measured price</h2>
      <p style={{ margin: 0, color: C.body, fontSize: 16, lineHeight: 1.5, maxWidth: 720 }}>
        Three samplers read Gemini&apos;s order book on their own and each signs its own average. Three valid averages: the middle one counts. Two: their mean, if they are within half a point. Otherwise
        nothing moves.
      </p>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map((r) => {
          const att = r.payload.attestation;
          return (
            <div key={r.id} style={{ borderBottom: `1px solid ${C.faint}`, padding: "12px 0", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", alignItems: "baseline" }}>
                <strong style={{ fontSize: 17 }}>{r.kind === "outcome" ? "Gemini's result" : KIND_TEXT[r.payload.kind ?? 0]}</strong>
                {r.payload.windowStart && (
                  <span style={{ color: C.muted, fontSize: 15 }}>
                    {formatDate(r.payload.windowStart * 1000)}, {r.payload.windowEnd! - r.payload.windowStart} s
                  </span>
                )}
                <span style={{ fontSize: 15 }}>
                  {r.kind === "outcome"
                    ? ""
                    : att
                      ? att.valid
                        ? `${(att.priceYes / 10_000).toFixed(2)}% YES (${r.payload.reason})`
                        : `no price: ${r.payload.reason}`
                      : r.status === "measuring"
                        ? "measuring"
                        : r.status}
                </span>
                {r.tx && (
                  <a href={txUrl(r.tx)} target="_blank" rel="noreferrer" style={{ fontSize: 15 }}>
                    transaction
                  </a>
                )}
                {r.error && <span style={{ color: C.signalInk, fontSize: 14 }}>{r.error.slice(0, 120)}</span>}
              </div>
              {r.payload.memo && (
                <span style={{ fontSize: 14, color: C.body }}>
                  Memo on Arc: <em>{r.payload.memo}</em>
                </span>
              )}
              {r.payload.averages && (
                <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexWrap: "wrap", gap: "2px 20px", fontSize: 14, color: C.muted }}>
                  {r.payload.averages.map((x) => (
                    <li key={x.signer}>
                      sampler {short(x.signer)}: {x.valid ? `${(Number(x.ppm) / 10_000).toFixed(2)}%` : "not enough valid readings"} ({x.sampleCount} readings)
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

export function PotView({ id }: { id: string }) {
  const { data: pot, error } = usePolling<HcPot>(`/api/hc/pots/${id}`, 3000);
  const who = useActor();
  const live = useLivePrice(pot?.market?.instrument ?? null, Number(pot?.data.window ?? 30));
  const nowS = Math.floor(useNow() / 1000);
  const fresh = useSearchParams().get("new") === "1";
  const { tech } = useTechMode();
  const names = useNames([pot?.owners.yes, pot?.owners.no, pot?.data.joiner, ...(pot?.events ?? []).flatMap((e) => [e.args.creator, e.args.joiner, e.args.taker, e.args.from, e.args.to])]);

  if (!pot)
    return error ? (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
        <Cat pose="box" size={200} />
        <p style={{ fontSize: 19 }}>No pot {id} here. {error}</p>
      </div>
    ) : (
      <Cat pose="peek" size={160} />
    );

  const m = pot.market;
  const me = who.actor?.account ?? null;
  const nameOf = (a: string | null) => displayName(a, names, me, tech, a ? "a player" : "open seat");
  const scene = sceneOf(pot, live.smoothed, nowS, { me, names, tech });
  const story = storyOf(pot, nameOf);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 15, color: C.muted }}>
          Pot {pot.potId} · {m ? marketLine(m) : ""} · trading closes {formatDate(Number(pot.data.closeTime) * 1000)}
        </span>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 56, fontWeight: 600, lineHeight: 0.95 }}>{m ? marketTitle(m) : "Pot"}</h1>
        {m && (
          <p style={{ margin: 0, fontSize: 18, color: C.ink }}>
            <strong>YES</strong> means: {yesMeans(m)}. <strong style={{ color: C.signalInk }}>NO</strong> means it does not happen.
          </p>
        )}
        {pot.practice && (
          <p role="note" style={{ margin: 0, padding: "10px 14px", border: `1.5px solid ${C.ink}`, fontSize: 16, lineHeight: 1.45, maxWidth: 760 }}>
            <strong>Practice pot.</strong> The other side is the practice cat, HonorCat&apos;s own test account. It never leaves on its own; you can leave whenever you like,
            or hold until Gemini&apos;s result. Test money only.
          </p>
        )}
        <p style={{ margin: 0, fontSize: 19, color: C.body }}>{STATE_TEXT[pot.state]}</p>
        {fresh && pot.state === "Open" && <p style={{ margin: 0, fontSize: 17, color: C.ink }}>Your pot is open. Send the link to whoever takes the other side.</p>}
      </header>

      <Rope {...scene} trail={live.trail} speed={live.speed} />

      {pot.state !== "Divided" && pot.state !== "Settled" && pot.state !== "Expired" && <SamplerNotice />}

      <Actions pot={pot} who={who} price={live.smoothed} nowS={nowS} />

      {story.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>What happened</h2>
          <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
            {story.map((s, i) => (
              <li key={i} style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", padding: "10px 0", borderBottom: `1px solid ${C.faint}`, fontSize: 16, lineHeight: 1.45 }}>
                <span style={{ color: C.muted, minWidth: 150 }}>{s.at ? formatDate(s.at * 1000) : ""}</span>
                <span style={{ flex: "1 1 420px" }}>{s.text}</span>
                <a href={txUrl(s.tx)} target="_blank" rel="noreferrer" style={{ color: C.muted, fontSize: 14 }}>
                  transaction
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

      <Windows pot={pot} />

      <nav style={{ display: "flex", flexWrap: "wrap", gap: "8px 28px", fontSize: 16 }}>
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
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>Test version on Arc testnet: test money only. Not financial advice.</p>
    </div>
  );
}
