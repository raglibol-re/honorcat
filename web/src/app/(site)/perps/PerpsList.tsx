"use client";

import Link from "next/link";
import { CatState } from "@/components/cat/CatState";
import { C, F } from "@/components/cat/tokens";
import { PerpRows } from "@/components/perp/PerpRows";
import { useActor } from "@/components/pot/Who";
import { ButtonLink } from "@/components/ui/Button";
import { usePolling } from "@/lib/api";
import type { PerpSummary } from "@/lib/perp";

const h2 = { margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 } as const;

function Section({
  title,
  list,
  empty,
  me,
  offer,
}: {
  title: string;
  list: { data: { perps: PerpSummary[] } | null; error: string | null };
  empty: React.ReactNode;
  me?: string | null;
  offer?: boolean;
}) {
  const rows = list.data?.perps ?? [];
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={h2}>{title}</h2>
      {!list.data ? (
        list.error ? (
          <p style={{ margin: 0, color: C.signalInk }}>Could not read perps just now; trying again.</p>
        ) : (
          <CatState kind="loading" text="Reading perps from Arc…" size={80} />
        )
      ) : rows.length === 0 ? (
        <p style={{ margin: 0, fontSize: 17, color: C.body }}>{empty}</p>
      ) : (
        <PerpRows perps={rows} me={me} offer={offer} />
      )}
    </section>
  );
}

/** Every perp: offers waiting for a second player, yours, the ones running now, and recent endings. */
export function PerpsList() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const open = usePolling<{ perps: PerpSummary[] }>("/api/hc/perps?state=open", 10_000);
  const live = usePolling<{ perps: PerpSummary[] }>("/api/hc/perps?state=live&limit=20", 10_000);
  const ended = usePolling<{ perps: PerpSummary[] }>("/api/hc/perps?state=ended&limit=10", 30_000);
  const mine = usePolling<{ perps: PerpSummary[] }>(me ? `/api/hc/perps?owner=${me}` : null, 10_000);
  const offers = {
    ...open,
    data: open.data && { perps: open.data.perps.filter((p) => p.a.toLowerCase() !== (me ?? "").toLowerCase()) },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40, maxWidth: 900 }}>
      <header style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Perps</h1>
          <ButtonLink href="/pots/new?kind=perp">Start a perp</ButtonLink>
        </div>
        <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, maxWidth: 720, color: C.body }}>
          Short ropes on one market, one after another. Lose a rope at a post and you lose one life.{" "}
          <Link href="/how">How it works</Link> · <Link href="/leaderboard?kind=perps">Perp leaderboard</Link>
        </p>
      </header>

      <Section
        title="Take the other side"
        list={offers}
        me={me}
        offer
        empty={
          <>
            No perps waiting for a second player. <Link href="/pots/new?kind=perp">Start one</Link> and send the link to a
            friend, or play the practice cat.
          </>
        }
      />
      {me && (
        <Section title="Yours" list={mine} me={me} empty={<>You are not in a perp yet.</>} />
      )}
      <Section title="Running now" list={live} me={me} empty={<>No perp is running right now.</>} />
      <Section title="Recently ended" list={ended} me={me} empty={<>None yet.</>} />
    </div>
  );
}
