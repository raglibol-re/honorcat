"use client";

import Link from "next/link";
import { CatState } from "@/components/cat/CatState";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { useFollowing } from "@/components/pot/Follow";
import { SignIn, useActor } from "@/components/pot/Who";
import { ButtonLink } from "@/components/ui/Button";
import { usePolling } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { nickname, useNames } from "@/lib/names";

type Item = {
  kind: "pot" | "perp";
  id: string;
  leader: string;
  side: number | null;
  at: number | null;
  state: string;
  copyToken: string | null;
  entryPpm: number | null;
  market: { title: string; label: string; instrument: string } | null;
};

const STATE: Record<string, string> = {
  Open: "waiting for someone",
  Joining: "starting",
  Live: "running",
  ExitRequested: "someone is leaving",
  Divided: "ended",
  Settled: "ended",
  Expired: "ended",
  Funded: "starting",
  Running: "running",
  Ended: "ended",
};

/** New pots and perps of the players you follow, with a copy button on the ones still running. */
export function Feed() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const follows = useFollowing(who);
  const { data, error } = usePolling<{ items: Item[] }>(me ? `/api/hc/feed?account=${me}` : null, 20_000);
  const names = useNames((data?.items ?? []).map((i) => i.leader));
  const h1 = { margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 } as const;

  if (!who.actor)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <h1 style={h1}>Feed</h1>
        <SignIn who={who} purpose="Sign in to see the new pots of the players you follow." />
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 860 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={h1}>Feed</h1>
        <p style={{ margin: 0, fontSize: 18, color: C.body, lineHeight: 1.5 }}>
          New pots and perps of the players you follow{follows.data ? ` (${follows.data.following.length})` : ""}, from the last two weeks. Follow players from
          the <Link href="/leaderboard">leaderboard</Link> or their honor record. Copying opens the same market and side; you choose only your stake, and 5%
          of any profit goes to the player you copy.
        </p>
      </header>
      {!data ? (
        <CatState kind={error ? "error" : "loading"} text={error ? "Could not read your feed just now; trying again." : "Reading your feed…"} size={90} />
      ) : data.items.length === 0 ? (
        <CatState
          kind="empty"
          text={follows.data?.following.length ? "Nothing new from the players you follow in the last two weeks." : "You do not follow anyone yet. Find players on the leaderboard."}
          size={110}
        />
      ) : (
        <ol style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
          {data.items.map((i) => {
            const name = names[i.leader] ?? nickname(i.leader);
            const href = i.kind === "perp" ? `/perps/${i.id}` : `/pots/${i.id}`;
            return (
              <li key={`${i.kind}-${i.id}-${i.leader}`} style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", alignItems: "baseline", padding: "14px 4px", borderBottom: `1px solid ${C.faint}` }}>
                <span style={{ flex: "1 1 360px", fontSize: 17, lineHeight: 1.45 }}>
                  <Link href={`/record/${i.leader}`} style={{ color: C.ink }}>
                    <CatName account={i.leader} name={name} />
                  </Link>{" "}
                  took {i.side === 0 ? "YES" : i.side === 1 ? "NO" : "a side"} in <Link href={href}>{i.kind === "perp" ? `perp ${i.id}` : `pot ${i.id}`}</Link>
                  {i.market ? ` on “${i.market.title}${i.market.label && i.market.label !== "Yes" ? `: ${i.market.label}` : ""}”` : ""}
                  <span style={{ color: C.muted }}> · {STATE[i.state] ?? i.state}{i.at ? ` · ${formatDate(i.at * 1000)}` : ""}</span>
                  {i.entryPpm !== null && <span style={{ color: C.muted }}> · entered at {(i.entryPpm / 10_000).toFixed(1)}%</span>}
                </span>
                {i.copyToken && (
                  <ButtonLink size="sm" variant="quiet" href={`/pots/new?copy=${i.copyToken}&pot=${i.id}`}>
                    Copy {name}
                  </ButtonLink>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
