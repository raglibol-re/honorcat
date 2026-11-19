"use client";

import Link from "next/link";
import { useState } from "react";
import { HONOR_COSMETICS, CURRENT_HONOR as H, TITLES } from "@honorcat/relay/honorConfig";
import { CatState } from "@/components/cat/CatState";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { Bell, fmtHonor } from "@/components/honor/Honor";
import { useActor } from "@/components/pot/Who";
import { usePolling } from "@/lib/api";
import { nickname, useNames } from "@/lib/names";

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 34, fontWeight: 600 } as const;
const p = { margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body, maxWidth: 760 } as const;

const RULES: [string, string][] = [
  ["Holding a pot or a perp to its end", `${H.holdPerHour} for each hour held, at most ${H.holdMaxPerPot} a pot`],
  ["A handshake", `${H.handshake} to each side`],
  ["An open side of yours is joined", `${H.openJoined}`],
  ["Taking over a side so the other player can go on", `${H.takeover}`],
  ["Sending “Well played”", `${H.goodGame}, once a pot`],
  ["A friend you invited finishes their first pot that counts", `${H.referral}`],
  ["Joining a group on the smaller team (when groups come)", `${H.smallerTeam}`],
  ["Playing on consecutive days", `${H.streakDay} a day after the first, at most ${H.streakMaxDays} days in a row`],
];

type Row = { account: string; points: number; total: number; title: string };

/** What Honor is, how to earn it, why it is worth no money, how farming is handled, and the table. */
export function HonorPage() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const [days, setDays] = useState(0);
  const [view, setView] = useState<"everyone" | "friends">("everyone");
  const q = `/api/hc/honor/board?days=${days}${view === "friends" && me ? `&friendsOf=${me}` : ""}`;
  const board = usePolling<{ rows: Row[] }>(q, 60_000);
  const names = useNames((board.data?.rows ?? []).map((r) => r.account));
  const off = !!board.error && /404|off/.test(board.error);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 900 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95, display: "flex", gap: 14, alignItems: "center" }}>
          <Bell size={44} /> Honor
        </h1>
        <p style={p}>
          Honor rewards how you play, never what you win. Holding a pot to its end, shaking hands, letting someone take over, saying “Well played”: that earns
          honor. Winning, the size of your stake, leverage and volume earn nothing. Leaving a pot is your right: it earns nothing and costs nothing.
        </p>
        {off && (
          <p role="note" style={{ ...p, border: `1.5px solid ${C.ink}`, padding: "10px 14px" }}>
            Honor is not switched on yet. The rules below are the ones it will use.
          </p>
        )}
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>No cash value, ever</h2>
        <p style={p}>
          Honor is not a token, is never airdropped, cannot be bought, sold or transferred, has no cash value, and is never exchanged for money or fee
          discounts. It shows on your cat: a title and the cat cosmetics you unlock.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>How to earn it</h2>
        <table style={{ borderCollapse: "collapse", width: "100%", maxWidth: 760, fontSize: 16 }}>
          <tbody>
            {RULES.map(([what, pts]) => (
              <tr key={what}>
                <td style={{ padding: "9px 8px 9px 0", borderBottom: `1px solid ${C.faint}` }}>{what}</td>
                <td style={{ padding: "9px 0", borderBottom: `1px solid ${C.faint}`, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ ...p, fontSize: 15 }}>
          Rules version {H.version}. A change of any value is a new version; the history keeps which version counted what.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>How farming is handled</h2>
        <ul style={{ ...p, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          <li>Nothing for practice pots, Grok Bot pots, a stake under ${(H.minStake / 1e6).toFixed(2)} a side, or pots that end within {H.minDurationS / 60} minutes of starting.</li>
          <li>The same player again: the first pot within 24 hours counts in full, each further pot with them halves again.</li>
          <li>
            New accounts earn half honor until they have finished pots with {H.trustCounterparties} different trusted players (a closed circle of new accounts
            stays at half). The founding players before 20 November 2026 count for each other.
          </li>
          <li>Two accounts first funded from the same address earn nothing from each other (HonorCat&apos;s welcome money does not count as a link).</li>
          <li>
            A daily check flags pairs with many quick pots (joined within a minute, ended within an hour). Their honor from each other is removed, and the
            history shows why.
          </li>
          <li>A friend&apos;s honor for inviting counts only if the friend passes the same checks.</li>
        </ul>
        <p style={{ ...p, fontSize: 15 }}>
          What it cannot catch: one person with several accounts funded from different places who plays slowly and with many others looks like many honest
          players. That is why honor buys nothing.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>Titles and cosmetics</h2>
        <p style={p}>
          {TITLES.map((t) => `${t.title} from ${t.min}`).join(" · ")}. Cosmetics: {HONOR_COSMETICS.map((c) => `${c.label} at ${c.min}`).join(", ")}.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 id="table" style={h2}>
          Honor table
        </h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div role="radiogroup" aria-label="Period" style={{ display: "flex", gap: 8 }}>
            <button type="button" role="radio" aria-checked={days === 0} className="hc-choice hc-choice--sm" onClick={() => setDays(0)}>
              All time
            </button>
            <button type="button" role="radio" aria-checked={days === 7} className="hc-choice hc-choice--sm" onClick={() => setDays(7)}>
              This week
            </button>
          </div>
          <div role="radiogroup" aria-label="Who" style={{ display: "flex", gap: 8 }}>
            <button type="button" role="radio" aria-checked={view === "everyone"} className="hc-choice hc-choice--sm" onClick={() => setView("everyone")}>
              Everyone
            </button>
            <button type="button" role="radio" aria-checked={view === "friends"} className="hc-choice hc-choice--sm" disabled={!me} onClick={() => setView("friends")}>
              My friends
            </button>
          </div>
        </div>
        {off ? null : !board.data ? (
          <CatState kind={board.error ? "error" : "loading"} text={board.error ? "Could not read the table just now." : "Counting honor…"} size={80} />
        ) : board.data.rows.length === 0 ? (
          <p style={p}>No honor earned in this period yet.</p>
        ) : (
          <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}`, maxWidth: 760 }}>
            {board.data.rows.map((r, i) => (
              <li key={r.account} style={{ display: "flex", gap: 14, alignItems: "baseline", padding: "10px 4px", borderBottom: `1px solid ${C.faint}`, fontSize: 16 }}>
                <span style={{ minWidth: 26, color: C.muted }}>{i + 1}</span>
                <Link href={`/record/${r.account}`} style={{ color: C.ink, flex: 1 }}>
                  <CatName account={r.account} name={r.account === me?.toLowerCase() ? "you" : (names[r.account] ?? nickname(r.account))} />
                </Link>
                <span style={{ color: C.muted }}>{r.title}</span>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>{fmtHonor(r.points)}</strong>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>Check it yourself</h2>
        <p style={p}>
          Honor is counted only from the contracts&apos; events on Arc (and the signed “Well played” notes), by rules published in the repository
          (docs/honor.md): anyone can count again and compare. Each player&apos;s history on their <Link href={me ? `/record/${me}` : "/leaderboard"}>honor record</Link>{" "}
          shows every point with its reason. A daily root of all balances posted on Arc, with a proof you can check in your browser, comes next.
        </p>
      </section>
    </div>
  );
}
