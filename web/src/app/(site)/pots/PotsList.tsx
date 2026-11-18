"use client";

import { CatState } from "@/components/cat/CatState";
import Link from "next/link";
import { Cat } from "@/components/cat/Cat";
import { C, F } from "@/components/cat/tokens";
import { AccountLine, btn, SignIn, useActor } from "@/components/pot/Who";
import { usePolling } from "@/lib/api";
import { formatDate, short } from "@/lib/format";
import { sideOf, type HcPotSummary } from "@/lib/hc";
import { useNow } from "@/lib/useNow";
import { marketTitle, sidesOf } from "@/lib/marketName";
import { CatName } from "@/components/cat/PlayerCat";
import { nickname, useNames } from "@/lib/names";
import { useTechMode } from "@/components/TechMode";
import { isInPlay, StatusBadge } from "@/components/pot/Status";

/** The pot's size in dollars: v2 pots carry their pot value, v1 pots their notional (at the start, once ended). */
function sizeOf(p: HcPotSummary) {
  const d = p.data as unknown as Record<string, string | undefined> & { v2?: boolean };
  if (d.v2) {
    const ticks = (Number(d.upper) - Number(d.lower)) / 100;
    const size = d.size !== "0" ? d.size : d.initialSize;
    return (ticks * Number(size ?? 0)) / 1e6;
  }
  return Number(d.notional === "0" ? (d.initialNotional ?? 0) : (d.notional ?? 0)) / 1e6;
}

function Rows({ pots, me }: { pots: HcPotSummary[]; me?: string | null }) {
  const { tech } = useTechMode();
  const names = useNames(pots.flatMap((p) => [p.owners.yes, p.owners.no]));
  return (
    <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
      {pots.map((p) => {
        const side = sideOf(p, me);
        const n = sizeOf(p);
        const d = p.data as unknown as { v2?: boolean; expiry?: string };
        const rope = Boolean(d.v2 && Number(d.expiry ?? 0) > 0);
        return (
          <Link
            key={p.potId}
            href={`/pots/${p.potId}`}
            className="hc-row"
            style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px", alignItems: "baseline", padding: "14px 6px", borderBottom: `1px solid ${C.faint}`, textDecoration: "none", color: C.ink }}
          >
            <span style={{ fontFamily: F.cond, fontSize: 22, fontWeight: 600, minWidth: 48 }}>#{p.potId}</span>
            <span style={{ fontSize: 17, fontWeight: 600, flex: "1 1 280px" }}>
              {p.practice && <span style={{ border: `1.5px solid ${C.ink}`, padding: "0 6px", marginRight: 8, fontSize: 14, fontWeight: 600 }}>Practice</span>}
              {p.market ? marketTitle(p.market) : "Unknown market"}
            </span>
            <StatusBadge state={p.state} rope={rope} />
            <span style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{Number.isFinite(n) ? `$${n.toFixed(2)}` : ""}</span>
            {side !== null && p.market && <span style={{ fontSize: 15, color: C.muted }}>you hold “{side === 0 ? sidesOf(p.market).yes : sidesOf(p.market).no}”</span>}
            <span style={{ fontSize: 14, color: C.muted }}>
              {isInPlay(p.state)
                ? rope
                  ? `ends by ${formatDate(Number(d.expiry) * 1000)} at the latest`
                  : `trading closes ${formatDate(Number(p.data.closeTime) * 1000)}`
                : `market closed ${formatDate(Number(p.data.closeTime) * 1000)}`}
            </span>
            {side === null && (p.owners.yes ?? p.owners.no) && (
              <span style={{ fontSize: 15, color: C.muted }}>
                <CatName account={p.owners.yes ?? p.owners.no} name={names[(p.owners.yes ?? p.owners.no)!.toLowerCase()] ?? nickname((p.owners.yes ?? p.owners.no)!.toLowerCase())} />
                {tech ? ` · ${short(p.owners.yes ?? p.owners.no ?? "")}` : ""}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export function PotsList() {
  const who = useActor();
  const me = who.actor?.account ?? null;
  const mine = usePolling<{ pots: HcPotSummary[] }>(me ? `/api/hc/pots?owner=${me}` : null, 6000);
  const open = usePolling<{ pots: HcPotSummary[] }>(`/api/hc/pots?state=open`, 8000);
  const now = useNow();
  const offers = (open.data?.pots ?? []).filter((p) => sideOf(p, me) === null && Number(p.data.closeTime) * 1000 > now);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <header style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Pots</h1>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <Link href="/pots/together" style={{ ...btn, background: "transparent", color: C.ink, border: `1.5px solid ${C.ink}`, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            With a friend
          </Link>
          <Link href="/pots/new" style={{ ...btn, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
            Start a pot
          </Link>
        </div>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Yours</h2>
        {!who.actor ? (
          <SignIn who={who} purpose="Sign in to see the pots you are in." />
        ) : (
          <>
            <AccountLine who={who} />
            <Link href={`/record/${me}`} style={{ fontSize: 16 }}>
              Your honor record
            </Link>
            {mine.data && mine.data.pots.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <Cat pose="box" size={140} />
                <p style={{ margin: 0, fontSize: 17, color: C.body }}>
                  No pots yet. <Link href="/pots/new">Start one</Link> or take a side below.
                </p>
              </div>
            ) : (
              <>
                <h3 style={{ margin: "8px 0 0", fontSize: 18, fontWeight: 600 }}>In play</h3>
                {(mine.data?.pots ?? []).some((p) => isInPlay(p.state)) ? (
                  <Rows pots={(mine.data?.pots ?? []).filter((p) => isInPlay(p.state))} me={me} />
                ) : (
                  <p style={{ margin: 0, fontSize: 16, color: C.muted }}>Nothing in play right now.</p>
                )}
                {(mine.data?.pots ?? []).some((p) => !isInPlay(p.state)) && (
                  <>
                    <h3 style={{ margin: "16px 0 0", fontSize: 18, fontWeight: 600 }}>Finished</h3>
                    <Rows pots={(mine.data?.pots ?? []).filter((p) => !isInPlay(p.state))} me={me} />
                  </>
                )}
              </>
            )}
          </>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 style={{ margin: 0, fontFamily: F.cond, fontSize: 32, fontWeight: 600 }}>Waiting for someone</h2>
        {offers.length ? <Rows pots={offers} me={me} /> : <CatState kind="empty" text="No open offers right now. Start one, or try it alone against the practice cat." size={110} />}
      </section>
    </div>
  );
}
