"use client";

import Link from "next/link";
import { useState } from "react";
import { CatState } from "@/components/cat/CatState";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { btn, useActor } from "@/components/pot/Who";
import { usePolling } from "@/lib/api";
import { nickname, useNames } from "@/lib/names";

type Row = { account: string; pots: number; heldToEnd: number; paid: string; treats: string; copycats: number };
const $ = (base: string) => `$${(Number(base) / 1e6).toFixed(2)}`;

/** The weekly table (or all time), for everyone or only the players you have met in a pot. */
export function Leaderboard() {
  const who = useActor();
  const me = who.actor?.account.toLowerCase() ?? null;
  const [days, setDays] = useState(7);
  const [friends, setFriends] = useState(false);
  const q = `/api/hc/leaderboard?days=${days}${friends && me ? `&friendsOf=${me}` : ""}`;
  const { data, error } = usePolling<{ rows: Row[] }>(q, 30_000);
  const names = useNames((data?.rows ?? []).map((r) => r.account));
  const toggle = (on: boolean) => ({ ...btn, minHeight: 44, padding: "0 16px", background: on ? C.ink : "transparent", color: on ? C.page : C.ink, border: `1.5px solid ${C.ink}` });
  const th = { textAlign: "right" as const, padding: "8px 10px", fontSize: 14, color: C.muted, fontWeight: 600, borderBottom: `1.5px solid ${C.ink}` };
  const td = { textAlign: "right" as const, padding: "10px", fontVariantNumeric: "tabular-nums" as const, borderBottom: `1px solid ${C.faint}` };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Leaderboard</h1>
        <p style={{ margin: 0, fontSize: 18, color: C.body, maxWidth: 680 }}>
          Pots played, held to the end, treats earned and how many players copy each cat. Treats are shares of fees other players paid; nothing goes to HonorCat. Practice pots do not count.
        </p>
      </header>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div role="radiogroup" aria-label="Period" style={{ display: "flex", gap: 8 }}>
          <button type="button" role="radio" aria-checked={days === 7} style={toggle(days === 7)} onClick={() => setDays(7)}>
            This week
          </button>
          <button type="button" role="radio" aria-checked={days === 0} style={toggle(days === 0)} onClick={() => setDays(0)}>
            All time
          </button>
        </div>
        <div role="radiogroup" aria-label="Who" style={{ display: "flex", gap: 8 }}>
          <button type="button" role="radio" aria-checked={!friends} style={toggle(!friends)} onClick={() => setFriends(false)}>
            Everyone
          </button>
          <button type="button" role="radio" aria-checked={friends} style={toggle(friends)} disabled={!me} onClick={() => setFriends(true)} title={me ? undefined : "Sign in to see the players you have met"}>
            My friends
          </button>
        </div>
      </div>
      {friends && me && <p style={{ margin: 0, fontSize: 15, color: C.muted }}>Friends: you and every player you have met in a pot.</p>}
      {!data ? (
        <CatState kind={error ? "error" : "loading"} text={error ?? "Counting the pots…"} />
      ) : data.rows.length === 0 ? (
        <CatState kind="empty" text={days === 7 ? "Nobody has played this week yet." : "Nobody has played yet."} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560, fontSize: 16 }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>#</th>
                <th style={{ ...th, textAlign: "left" }}>Player</th>
                <th style={th}>Pots</th>
                <th style={th}>Held to the end</th>
                <th style={th}>Treats earned</th>
                <th style={th}>Copycats</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r, i) => (
                <tr key={r.account} style={{ background: r.account === me ? C.faint : "transparent" }}>
                  <td style={{ ...td, textAlign: "left", color: C.muted }}>{i + 1}</td>
                  <td style={{ ...td, textAlign: "left" }}>
                    <Link href={`/record/${r.account}`} style={{ color: C.ink }}>
                      <CatName account={r.account} name={r.account === me ? "you" : (names[r.account] ?? nickname(r.account))} strong={r.account === me} />
                    </Link>
                  </td>
                  <td style={td}>{r.pots}</td>
                  <td style={td}>{r.heldToEnd}</td>
                  <td style={td}>{$(r.treats)}</td>
                  <td style={td}>{r.copycats}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
