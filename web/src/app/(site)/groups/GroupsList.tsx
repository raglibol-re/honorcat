"use client";

import Link from "next/link";
import { CatState } from "@/components/cat/CatState";
import { C, F } from "@/components/cat/tokens";
import { useActor } from "@/components/pot/Who";
import { ButtonLink } from "@/components/ui/Button";
import { usePolling } from "@/lib/api";
import { money } from "@/lib/currency";
import { useNow } from "@/lib/useNow";
import type { GroupSummary, GroupsStatus } from "@/lib/group";

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;

function Rows({ list }: { list: GroupSummary[] }) {
  const now = useNow();
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
      {list.map((g) => (
        <li key={g.groupId} style={{ border: `1.5px solid ${C.ink}`, padding: "12px 14px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between" }}>
          <Link href={`/groups/${g.groupId}`} style={{ fontFamily: F.cond, fontSize: 24, fontWeight: 600 }}>
            {g.names[0]} vs {g.names[1]}
          </Link>
          <span style={{ fontSize: 16, color: C.body }}>
            {g.members[0]} + {g.members[1]} members · pays {money(g.pools[0] ?? "0")} · {g.state === "Open" ? (g.closeTime * 1000 > now ? "open" : "waiting for the result") : g.state === "Settled" ? "settled" : "deposits back"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Group pots: two teams on one market, anyone joins either team with any amount. */
export function GroupsList() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const all = usePolling<{ status: GroupsStatus; groups: GroupSummary[] }>("/api/hc/groups", 10_000);
  const mine = usePolling<{ status: GroupsStatus; groups: GroupSummary[] }>(me ? `/api/hc/groups?account=${me}` : null, 10_000);
  const on = all.data?.status.on ?? false;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36, maxWidth: 900 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Groups</h1>
        <p style={{ margin: 0, fontSize: 18, color: C.body, maxWidth: 680 }}>
          Two teams take opposite sides of one Gemini market. Anyone joins a team with any amount; joins and leaves are gathered for a minute and priced together over the 30 seconds after. Leave whenever you like at that price; at the result, the right team&apos;s members each get what their share pays.
        </p>
        {on && (
          <div>
            <ButtonLink href="/pots/new?kind=group">Start a group</ButtonLink>
          </div>
        )}
        {all.data && !on && <p style={{ margin: 0, fontSize: 16, color: C.signalInk }}>Coming soon: groups are being tested on Arc.</p>}
      </header>
      {me && mine.data && mine.data.groups.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={h2}>Yours</h2>
          <Rows list={mine.data.groups} />
        </section>
      )}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>All groups</h2>
        {!all.data ? (
          all.error ? <p style={{ margin: 0, color: C.signalInk }}>Could not read groups just now; trying again.</p> : <CatState kind="loading" text="Reading groups from Arc…" size={80} />
        ) : all.data.groups.length === 0 ? (
          <p style={{ margin: 0, fontSize: 17, color: C.body }}>No groups yet.</p>
        ) : (
          <Rows list={all.data.groups} />
        )}
      </section>
    </div>
  );
}
