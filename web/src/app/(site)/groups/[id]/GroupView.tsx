"use client";

import { FeeNote, useFees } from "@/components/pot/Receipts";

import { Watching } from "@/components/pot/Watching";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CatState } from "@/components/cat/CatState";
import { GeminiLink } from "@/components/cat/GeminiLink";
import { C, F } from "@/components/cat/tokens";
import { Invite } from "@/components/pot/Invite";
import { InviteQR } from "@/components/pot/InviteQR";
import { Reactions } from "@/components/pot/Reactions";
import { Rope } from "@/components/pot/Rope";
import { useLivePrice } from "@/components/pot/usePrice";
import { BreakReminder } from "@/components/pot/BreakReminder";
import { SignIn, useActor } from "@/components/pot/Who";
import { ActionProgress, Button } from "@/components/ui/Button";
import { Input, Notice } from "@/components/ui/Field";
import { toast } from "@/components/ui/Toast";
import { pollFast, usePolling } from "@/lib/api";
import { money } from "@/lib/currency";
import { collect, getGroups, groupEventText, groupPath, joinTeam, leaveGroup, MAX_WAIT_BATCHES, P, valueOf, type GroupDetail, type GroupsStatus } from "@/lib/group";
import { plainError } from "@/lib/messages";
import { displayName, useNames } from "@/lib/names";
import { txUrl } from "@/lib/chain";
import { SITE_URL } from "@/lib/site";
import { useNow } from "@/lib/useNow";

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 30, fontWeight: 600 } as const;
const card: React.CSSProperties = { border: `1.5px solid ${C.ink}`, padding: 16, display: "flex", flexDirection: "column", gap: 10, background: C.panel };
const pct = (ppm: number) => `${(ppm / 10_000).toFixed(1)}%`;
const dollars = (s: string) => {
  const v = Number(s.replace(",", "."));
  return Number.isFinite(v) && v > 0 ? BigInt(Math.round(v * 1e6)) : 0n;
};

function secs(s: number) {
  if (s <= 0) return "now";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m} min ${s % 60} s` : `${s} s`;
}

/**
 * A group pot: two teams on one market. The rope hangs between the teams' cats with the number of
 * members at each post; under it the next clearing's countdown, each team's total, my standing and
 * the join and leave forms, then a join link and QR code per team.
 */
export function GroupView({ id }: { id: string }) {
  const who = useActor();
  const fees = useFees();
  const account = who.actor?.account ?? null;
  const { data: g, error } = usePolling<GroupDetail>(groupPath(id, account), 5_000);
  const [status, setStatus] = useState<GroupsStatus | null>(null);
  useEffect(() => {
    getGroups()
      .then((r) => setStatus(r.status))
      .catch(() => {});
  }, []);
  // Only an open group reads the live price; a settled one shows where the cat landed.
  const live = useLivePrice(g && g.state === "Open" ? (g.market?.instrument ?? null) : null);
  const names = useNames((g?.events ?? []).flatMap((e) => [e.args.account, e.args.creator]));
  const nowMs = useNow();
  const now = Math.floor(nowMs / 1000);

  // ?team=0|1 from a team's join link preselects that team
  const [team, setTeam] = useState<number>(0);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("team");
    if (t === "0" || t === "1") void Promise.resolve().then(() => setTeam(Number(t)));
  }, []);
  const [amount, setAmount] = useState("5");
  const [wait, setWait] = useState(true);
  const [leaveAll, setLeaveAll] = useState(true);
  const [leavePart, setLeavePart] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // The create form sends the creator here when the group opened but their first join failed.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("joinfailed");
    if (q) void Promise.resolve().then(() => setErr(`The group is open, but your first join did not go through: ${q} Join below.`));
  }, []);

  if (!g && error) return error.includes("no such group") ? <CatState kind="empty" text={`No group ${id} yet. A new group takes a few seconds to appear; check the link otherwise.`} /> : <CatState kind="error" text={error} />;
  if (!g) return <CatState kind="loading" text={`Reading group ${id} from Arc…`} />;

  const groups = status?.address ?? null;
  const [nameA, nameB] = g.names;
  const lastPrice = g.prices.length ? g.prices[g.prices.length - 1]!.price : null;
  // The rope shows the live 30-second price; the teams' totals use the last cleared price.
  const priceNow =
    g.state === "Settled" ? (g.outcome === 1 ? 1 : g.outcome === 0 ? 0 : lastPrice !== null ? lastPrice / P : null) : (live.smoothed ?? (lastPrice !== null ? lastPrice / P : null));
  const pricePpm = lastPrice ?? (live.smoothed !== null ? Math.round(live.smoothed * P) : null);
  const pool = BigInt(g.teams[0]?.pool ?? "0");
  // The two teams' cats: fixed, different furs (ginger for the first team, grey for the second).
  const furA = "ginger" as const;
  const furB = "grey" as const;
  const open = g.state === "Open";
  const settled = g.state === "Settled";
  const closing = open && now >= g.closeTime;
  const mine = g.mine;
  const myTeam = mine?.team ?? null;
  const myNotional = mine?.position.active ? BigInt(mine.position.notional) : 0n;
  const owed = mine ? BigInt(mine.claimable) : 0n;
  const nextClear = g.clock.collectingUntil;
  // Requests are taken until a minute before the close (the last window must end before it).
  const takingRequests = open && now + 120 < g.closeTime;

  const run = async (label: string, f: (onStep: (s: string) => void) => Promise<string>) => {
    setBusy(label);
    setErr(null);
    setStep(null);
    try {
      const msg = await f(setStep);
      toast(msg);
      pollFast();
    } catch (e) {
      setErr(plainError(e));
    } finally {
      setBusy(null);
      setStep(null);
    }
  };

  const joinAmount = dollars(amount);
  const joinTooSmall = joinAmount < 100_000n;
  // Test-version limit per player and group: $20 in all (joins waiting plus what the position cost).
  const PER_PLAYER = 20_000_000n;
  const already = (mine?.request ? BigInt(mine.request.escrow) : 0n) + (pricePpm !== null && myTeam !== null ? valueOf(myNotional, pricePpm, myTeam) : 0n);
  const joinTooBig = joinAmount + already > PER_PLAYER;
  const leaveN = leaveAll ? myNotional : dollars(leavePart) > myNotional ? myNotional : dollars(leavePart);
  const leaveValue = pricePpm !== null && myTeam !== null ? valueOf(leaveN, pricePpm, myTeam) : null;

  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 28, paddingBottom: 40 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
          <Link href="/groups">Groups</Link> · group {g.groupId}
        </p>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(36px, 7vw, 56px)", fontWeight: 600, lineHeight: 1 }}>
          {nameA} <span style={{ color: C.muted }}>vs</span> {nameB}
        </h1>
        {g.market && (
          <p style={{ margin: 0, fontSize: 18, color: C.body }}>
            {g.market.eventTitle}
            {g.market.label ? ` · ${g.market.label}` : ""} · {nameA} hold the yes side, {nameB} the no side.{" "}
            <GeminiLink ticker={g.market.eventTicker} label="Trade this market on Gemini" size={15} />
          </p>
        )}
      </header>

      {settled && (
        <Notice tone="success" role="status">
          The market settled: {g.outcome === 1 ? `${nameA} land the pot` : g.outcome === 0 ? `${nameB} land the pot` : "it was void, so every deposit went back"}.
          {owed > 0n || myNotional > 0n ? " Take out your share below." : ""}
        </Notice>
      )}
      {g.state === "Void" && <Notice tone="note">No result came by the deadline: everyone gets their team&apos;s remaining deposit back.</Notice>}

      <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Rope
          price={priceNow}
          notional={pool}
          names={{ yes: nameA, no: nameB }}
          phase={settled ? "settled" : open ? "live" : "expired"}
          receiver={settled ? (g.outcome === 1 ? 0 : g.outcome === 0 ? 1 : 2) : null}
          trail={live.trail}
          speed={live.speed}
          cats={{
            yes: { fur: furA, mood: "even", name: `${nameA} · ${g.teams[0]?.members ?? 0} cats` },
            no: { fur: furB, mood: "even", name: `${nameB} · ${g.teams[1]?.members ?? 0} cats` },
          }}
        />
        <Reactions potId={String(9_000_000_000 + Number(g.groupId))} />
        <Watching watchKey={`g${g.groupId}`} startHref="/pots/new?kind=group" tvHref={`/groups/${g.groupId}/tv`} player={myTeam !== null} />
        <p style={{ margin: 0, fontSize: 17 }}>
          {open && !closing && (
            <>
              <strong>Next clearing in {secs(nextClear - now)}</strong>: every join and leave asked for until then is priced together over the {g.window} s after.
            </>
          )}
          {closing && <strong>The market has closed: the group settles when Gemini publishes the result.</strong>}
          {lastPrice !== null && ` Last cleared at ${pct(lastPrice)} for ${nameA}, ${pct(P - lastPrice)} for ${nameB}.`}
        </p>
        {g.pricing.find((q) => q.status === "measuring" || q.status === "proposed" || q.status === "ready") && (
          <p role="status" style={{ margin: 0, fontSize: 15, color: C.muted }}>
            Pricing batch {g.pricing[0]!.batch}: the samplers are measuring the window and agreeing on a price.
          </p>
        )}
      </section>

      <section aria-label="Teams" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 }}>
        {[0, 1].map((t) => {
          const name = g.names[t]!;
          const price = pricePpm === null ? null : t === 0 ? pricePpm : P - pricePpm;
          const url = `${SITE_URL}/groups/${g.groupId}?team=${t}`;
          return (
            <div key={t} style={card}>
              <h2 style={h2}>{name}</h2>
              {g.lines?.[t] && <p style={{ margin: 0, fontSize: 16, color: C.body }}>{g.lines[t]}</p>}
              <p style={{ margin: 0, fontSize: 17 }}>
                {g.teams[t]?.members ?? 0} {(g.teams[t]?.members ?? 0) === 1 ? "member" : "members"} · team share {price === null ? "–" : money(valueOf(BigInt(g.teams[t]?.pool ?? "0"), pricePpm!, t))} · pays {money(BigInt(g.teams[t]?.pool ?? "0"))} if {t === 0 ? "yes" : "no"}
              </p>
              {open && takingRequests && (
                <details>
                  <summary style={{ cursor: "pointer", fontSize: 16 }}>Join link and QR code for {name}</summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                    <InviteQR url={url} size={160} label={`Scan to join ${name}`} />
                    <code style={{ fontSize: 13, wordBreak: "break-all" }}>{url}</code>
                  </div>
                </details>
              )}
            </div>
          );
        })}
      </section>

      {mine && (myNotional > 0n || mine.request || mine.exit || owed > 0n) && (
        <section aria-label="My position" style={{ ...card, gap: 12 }}>
          <h2 style={h2}>Your position</h2>
          {myNotional > 0n && myTeam !== null && (
            <p style={{ margin: 0, fontSize: 17 }}>
              On {g.names[myTeam]}: pays {money(myNotional)} if {myTeam === 0 ? "yes" : "no"}
              {pricePpm !== null ? `, worth ${money(valueOf(myNotional, pricePpm, myTeam))} at ${pct(myTeam === 0 ? pricePpm : P - pricePpm)}` : ""}.
            </p>
          )}
          {mine.request && (
            <p style={{ margin: 0, fontSize: 17 }}>
              Waiting to join: {money(mine.request.escrow)} in batch {mine.request.batch}
              {mine.request.wait ? `; an unmatched rest waits up to ${MAX_WAIT_BATCHES} minutes` : "; an unmatched rest comes back"}.
            </p>
          )}
          {mine.exit && <p style={{ margin: 0, fontSize: 17 }}>Leaving: {money(mine.exit.notional)} of notional, priced in batch {mine.exit.batch}.</p>}
          {owed > 0n && <p style={{ margin: 0, fontSize: 17 }}>Ready to take out: {money(owed)}.</p>}
          {who.actor && groups && (owed > 0n || !open || mine.request || mine.exit) && (
            <div>
              <Button
                variant="quiet"
                busy={busy === "collect"}
                disabled={Boolean(busy)}
                onClick={() =>
                  run("collect", async (s) => {
                    const r = await collect(who.actor!, groups, g.groupId, s);
                    return r.amount > 0n ? `${money(r.amount)} is back in your account.` : "Up to date: nothing to take out yet.";
                  })
                }
              >
                Take out what is mine
              </Button>
            </div>
          )}
          {open && takingRequests && myNotional > 0n && myTeam !== null && !mine.exit && who.actor && groups && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, borderTop: `1px solid ${C.grid}`, paddingTop: 12 }}>
              <strong style={{ fontSize: 17 }}>Leave</strong>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 16 }}>
                <input type="radio" checked={leaveAll} onChange={() => setLeaveAll(true)} /> All of it
              </label>
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 16, flexWrap: "wrap" }}>
                <input type="radio" checked={!leaveAll} onChange={() => setLeaveAll(false)} /> Part: pays-if-{myTeam === 0 ? "yes" : "no"} amount in $
                <Input inputMode="decimal" value={leavePart} onChange={(e) => (setLeavePart(e.target.value), setLeaveAll(false))} style={{ width: 110 }} aria-label="Notional to leave, in dollars" />
              </label>
              <p style={{ margin: 0, fontSize: 15, color: C.body }}>
                Priced in the next clearing at that window&apos;s price{leaveValue !== null ? ` (now about ${money((leaveValue * 99n) / 100n)} after the 1% exit fee, which goes to ${g.names[1 - myTeam]})` : ""}. Waiting joins on {g.names[myTeam]} take over your part first; if they do not cover it, {g.names[1 - myTeam]} shrinks by the rest.
              </p>
              <div>
                <Button
                  busy={busy === "leave"}
                  disabled={Boolean(busy) || leaveN === 0n}
                  onClick={() =>
                    run("leave", async (s) => {
                      await leaveGroup(who.actor!, groups, g.groupId, leaveN, s);
                      return "Your leave is in: it is priced in the next clearing.";
                    })
                  }
                >
                  Leave {leaveAll ? "the group" : "with this part"}
                </Button>
              </div>
            </div>
          )}
          <ActionProgress step={busy === "collect" || busy === "leave" ? step : null} />
          <FeeNote fees={fees} kind="pot_exec" payer={who.actor?.kind === "wallet" ? "wallet" : "honorcat"} />
        </section>
      )}

      {open && takingRequests && (
        <section aria-label="Join" style={{ ...card, gap: 12 }}>
          <h2 style={h2}>Join a team</h2>
          {!who.actor ? (
            <SignIn who={who} purpose="Sign in to join a team." />
          ) : (
            <>
              <div role="radiogroup" aria-label="Team" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[0, 1].map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={team === t}
                    className="hc-choice"
                    disabled={myTeam !== null && myTeam !== t}
                    onClick={() => setTeam(t)}
                    style={{ flex: "1 1 200px", padding: "12px 14px" }}
                  >
                    <strong style={{ fontFamily: F.cond, fontSize: 24 }}>{g.names[t]}</strong>
                    <span style={{ fontSize: 15 }}>{t === 0 ? "the yes side" : "the no side"}</span>
                  </button>
                ))}
              </div>
              {myTeam !== null && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>You are on {g.names[myTeam]}: an account stays on one team per group.</p>}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 17 }}>
                Amount in $ <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ width: 110 }} invalid={joinTooSmall} />
              </label>
              <p style={{ margin: 0, fontSize: 16, color: C.body }}>
                Your {money(joinAmount)} joins in the next clearing at the price of that window. If the other team cannot cover all of it, the rest waits or comes back, your choice.
              </p>
              <div role="radiogroup" aria-label="An unmatched rest" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 16 }}>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="radio" checked={wait} onChange={() => setWait(true)} /> The rest waits for later clearings (up to {MAX_WAIT_BATCHES} minutes), then comes back
                </label>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="radio" checked={!wait} onChange={() => setWait(false)} /> The rest comes back right after the clearing
                </label>
              </div>
              {mine?.request && (Number(mine.request.batch) !== g.clock.currentBatch || mine.request.wait !== wait || myTeam !== team) && (
                <Notice tone="note">You already have a join waiting; take it out first, or add to it in the same minute with the same choice.</Notice>
              )}
              <div>
                <Button
                  busy={busy === "join"}
                  disabled={Boolean(busy) || joinTooSmall || joinTooBig || !groups || (myTeam !== null && myTeam !== team)}
                  onClick={() =>
                    run("join", async (s) => {
                      await joinTeam(who.actor!, groups!, g.groupId, team, joinAmount, wait, s);
                      return `You asked to join ${g.names[team]} with ${money(joinAmount)}: it clears in the next batch.`;
                    })
                  }
                >
                  Join {g.names[team]} with {money(joinAmount)}
                </Button>
              </div>
              {joinTooSmall && <p style={{ margin: 0, fontSize: 15, color: C.signalInk }}>The smallest join is $0.10.</p>}
              {joinTooBig && <p style={{ margin: 0, fontSize: 15, color: C.signalInk }}>On the test version a player puts at most {money(PER_PLAYER)} into one group (you have about {money(already)} in it).</p>}
              <BreakReminder who={who} />
              <ActionProgress step={busy === "join" ? step : null} />
              <FeeNote fees={fees} kind="pot_exec" payer={who.actor?.kind === "wallet" ? "wallet" : "honorcat"} />
            </>
          )}
        </section>
      )}
      {err && <Notice tone="error" role="alert">{err}</Notice>}

      {open && takingRequests && (
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h2 style={h2}>Bring your team</h2>
          <Invite path={`/groups/${g.groupId}?team=${myTeam ?? team}`} text={`Join ${g.names[myTeam ?? team]} on HonorCat: ${g.market?.eventTitle ?? "a group pot"}`} account={account} />
        </section>
      )}

      {g.prices.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={h2}>Clearings</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, fontSize: 16 }}>
            {g.prices
              .slice(-10)
              .reverse()
              .map((b) => (
                <li key={b.batch}>
                  Batch {b.batch} at {pct(b.price)} for {nameA}
                  {BigInt(b.matched) > 0n ? `: ${money(b.matched)} matched on each team` : ""}
                  {b.at ? ` · ${new Date(b.at * 1000).toLocaleTimeString()}` : ""}
                </li>
              ))}
          </ol>
        </section>
      )}
      {(g.events ?? []).length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 style={h2}>What happened</h2>
          <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 4, fontSize: 16 }}>
            {(g.events ?? [])
              .map((e) => ({ e, text: groupEventText(e, g.names, (a) => displayName(a, names, account, false), money) }))
              .filter((x) => x.text)
              .slice(0, 12)
              .map(({ e, text }) => (
                <li key={`${e.tx}-${e.name}`}>
                  {text}
                  {e.at ? ` · ${new Date(e.at * 1000).toLocaleTimeString()}` : ""} ·{" "}
                  <a href={txUrl(e.tx)} target="_blank" rel="noreferrer">
                    receipt on Arc
                  </a>
                </li>
              ))}
          </ol>
        </section>
      )}
      <p style={{ margin: 0, fontSize: 14, color: C.muted }}>
        Nothing goes to a house: the only fee is 1% of what leaves early, and it goes to the other team. Most per team on this market: {money(g.cap)}.
      </p>
    </article>
  );
}
