"use client";

import Link from "next/link";
import { More } from "@/components/ui/More";
import { useEffect, useState } from "react";
import { CatState } from "@/components/cat/CatState";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { useActor } from "@/components/pot/Who";
import { FollowButton } from "@/components/pot/Follow";
import { HonorBadge } from "@/components/honor/Honor";
import { ButtonLink } from "@/components/ui/Button";
import { usePolling } from "@/lib/api";
import { nickname, useNames } from "@/lib/names";

import { money } from "@/lib/currency";
type Row = { account: string; pots: number; heldToEnd: number; paid: string; treats: string; copycats: number; finished: number; staked: string; net: string; returnPct: number | null; copy: { potId: string; token: string } | null };
type PerpRow = { account: string; perps: number; won: number; ropes: number; livesLost: number; result: string };
const signed = (base: string) => {
  const n = BigInt(base.split(".")[0] || "0");
  return `${n > 0n ? "+" : n < 0n ? "−" : ""}${money(n < 0n ? -n : n)}`;
};
const $ = (base: bigint | number | string) => money(base);

/** The weekly table (or all time), for everyone or only the players you have met in a pot. */
export function Leaderboard() {
  const who = useActor();
  const me = who.actor?.account.toLowerCase() ?? null;
  const [days, setDays] = useState(7);
  const [view, setView] = useState<"everyone" | "friends" | "following">("everyone");
  const friends = view === "friends";
  const [kind, setKind] = useState<"pots" | "perps">("pots");
  // The top ten first, like a scoreboard; your own row always shows; the rest on request.
  const [all, setAll] = useState(false);
  const TOP = 10;
  const shown = <T extends { account: string }>(rows: T[]) => (all ? rows : rows.filter((r, i) => i < TOP || r.account === me));
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("kind") === "perps") void Promise.resolve().then(() => setKind("perps"));
  }, []);
  const q = `/api/hc/leaderboard?days=${days}${friends && me ? `&friendsOf=${me}` : ""}${view === "following" && me && kind === "pots" ? `&following=${me}` : ""}${kind === "perps" ? "&kind=perps" : ""}`;
  const { data: raw, error } = usePolling<{ rows: (Row | PerpRow)[]; minPots?: number }>(q, 30_000);
  // a table from the other kind (still on screen while the new one loads) is not shown
  const data = raw && raw.rows.every((r) => (kind === "perps" ? "perps" in r : "pots" in r)) ? raw : null;
  const names = useNames((data?.rows ?? []).map((r) => r.account));
  const th = { textAlign: "right" as const, padding: "8px 10px", fontSize: 14, color: C.muted, fontWeight: 600, borderBottom: `1.5px solid ${C.ink}` };
  const td = { textAlign: "right" as const, padding: "10px", fontVariantNumeric: "tabular-nums" as const, borderBottom: `1px solid ${C.faint}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Leaderboard</h1>
        <p style={{ margin: 0, fontSize: 16 }}>
          Results here; how people play is on the <Link href="/honor#table">Honor table</Link>.
        </p>
        <More label="How the ranking works" style={{ maxWidth: 680 }}>
          <p style={{ margin: 0, fontSize: 16, color: C.body }}>
            {kind === "pots"
              ? "Ranked by result relative to stake: over finished pots, what a player was paid less what they put in, divided by what they put in. Also pots played, held to the end, treats earned and how many players copy each cat. Treats are shares of fees other players paid; nothing goes to HonorCat. Practice and Grok Bot pots do not count."
              : "Perps by net result: what each player gained or lost over all their ropes, with perps played, ropes played and lives lost. Perps with the practice cat do not count."}
          </p>
        </More>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div role="radiogroup" aria-label="Table" style={{ display: "flex", gap: 8 }}>
          <button type="button" role="radio" aria-checked={kind === "pots"} className="hc-choice hc-choice--sm" onClick={() => setKind("pots")}>
            Pots
          </button>
          <button type="button" role="radio" aria-checked={kind === "perps"} className="hc-choice hc-choice--sm" onClick={() => setKind("perps")}>
            Perps
          </button>
        </div>
        <div role="radiogroup" aria-label="Period" style={{ display: "flex", gap: 8 }}>
          <button type="button" role="radio" aria-checked={days === 7} className="hc-choice hc-choice--sm" onClick={() => setDays(7)}>
            This week
          </button>
          <button type="button" role="radio" aria-checked={days === 0} className="hc-choice hc-choice--sm" onClick={() => setDays(0)}>
            All time
          </button>
        </div>
        <div role="radiogroup" aria-label="Who" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" role="radio" aria-checked={view === "everyone"} className="hc-choice hc-choice--sm" onClick={() => setView("everyone")}>
            Everyone
          </button>
          <button type="button" role="radio" aria-checked={view === "friends"} className="hc-choice hc-choice--sm" disabled={!me} onClick={() => setView("friends")} title={me ? undefined : "Sign in to see the players you have met"}>
            My friends
          </button>
          {kind === "pots" && (
            <button type="button" role="radio" aria-checked={view === "following"} className="hc-choice hc-choice--sm" disabled={!me} onClick={() => setView("following")} title={me ? undefined : "Sign in to see the players you follow"}>
              People I follow
            </button>
          )}
        </div>
      </div>
      {friends && me && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>Friends: you and every player you have met in a pot.</p>}
      {view === "following" && me && kind === "pots" && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>You and the players you follow. <Link href="/feed">Their new pots</Link></p>}
      {kind === "pots" && data?.minPots && (
        <p style={{ margin: 0, fontSize: 15, color: C.muted }}>
          Ranked by result only with at least {data.minPots} finished pots in the period; the others follow, by pots played.
        </p>
      )}
      {!data ? (
        <CatState kind={error ? "error" : "loading"} text={error ?? "Counting the pots…"} />
      ) : data.rows.length === 0 ? (
        <CatState kind="empty" text={kind === "perps" ? (days === 7 ? "Nobody has played a perp this week yet." : "Nobody has played a perp yet.") : days === 7 ? "Nobody has played this week yet." : "Nobody has played yet."} />
      ) : kind === "perps" ? (
        <div style={{ overflowX: "auto", maxWidth: "100%", minWidth: 0, position: "relative" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 16 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Player</th>
                <th style={th}>Net result</th>
                <th style={th}>Perps (won)</th>
                <th style={th}>Ropes</th>
                <th style={th}>Lives lost</th>
              </tr>
            </thead>
            <tbody>
              {shown(data.rows as PerpRow[]).map((r) => (
                <tr key={r.account} style={{ background: r.account === me ? C.faint : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: C.muted }}>{data.rows.indexOf(r) + 1}</td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <Link href={`/record/${r.account}`} style={{ color: C.ink }}>
                      <CatName account={r.account} name={r.account === me ? "you" : (names[r.account] ?? nickname(r.account))} strong={r.account === me} />
                    </Link>
                    <span style={{ display: "block" }}>
                      <HonorBadge account={r.account} size={13} />
                    </span>
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: r.result.startsWith("-") ? C.signalInk : C.ink }}>{signed(r.result)}</td>
                  <td style={td}>
                    {r.perps} ({r.won})
                  </td>
                  <td style={td}>{r.ropes}</td>
                  <td style={td}>{r.livesLost}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ overflowX: "auto", maxWidth: "100%", minWidth: 0, position: "relative" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 16 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Player</th>
                <th style={th}>Result on stake</th>
                <th style={th}>Pots</th>
                <th style={th}>Held to the end</th>
                <th style={th}>Treats earned</th>
                <th style={th}>Copycats</th>
                <th style={th}>
                  <span className="hc-sr">Follow or copy</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown(data.rows as Row[]).map((r) => (
                <tr key={r.account} style={{ background: r.account === me ? C.faint : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: C.muted }}>{data.rows.indexOf(r) + 1}</td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <Link href={`/record/${r.account}`} style={{ color: C.ink }}>
                      <CatName account={r.account} name={r.account === me ? "you" : (names[r.account] ?? nickname(r.account))} strong={r.account === me} />
                    </Link>
                    <span style={{ display: "block" }}>
                      <HonorBadge account={r.account} size={13} />
                    </span>
                  </td>
                  <td style={{ ...td, fontWeight: 600, color: r.returnPct !== null && r.returnPct < 0 ? C.signalInk : C.ink }} title={`${signed(r.net)} on ${money(r.staked.split(".")[0] ?? "0")} put in, over ${r.finished} finished`}>
                    {r.returnPct === null ? "–" : `${r.returnPct > 0 ? "+" : r.returnPct < 0 ? "−" : ""}${Math.abs(r.returnPct).toFixed(1)}%`}
                  </td>
                  <td style={td}>{r.pots}</td>
                  <td style={td}>{r.finished ? `${Math.round((r.heldToEnd / Math.max(1, r.finished)) * 100)}%` : "–"}</td>
                  <td style={td}>{$(r.treats)}</td>
                  <td style={td}>{r.copycats}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <FollowButton who={who} leader={r.account} name={names[r.account] ?? nickname(r.account)} />
                      {r.copy && r.account !== me && (
                        <ButtonLink size="sm" variant="quiet" href={`/pots/new?copy=${r.copy.token}&pot=${r.copy.potId}`}>
                          Copy
                        </ButtonLink>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && data.rows.length > TOP && (
        <button type="button" className="hc-btn hc-btn--quiet hc-btn--sm" style={{ alignSelf: "flex-start" }} onClick={() => setAll((a) => !a)}>
          {all ? "Show the top ten" : `Show all ${data.rows.length} players`}
        </button>
      )}
    </div>
  );
}
