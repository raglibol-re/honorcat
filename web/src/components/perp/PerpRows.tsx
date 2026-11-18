"use client";

import Link from "next/link";
import { CatName } from "@/components/cat/PlayerCat";
import { C, F } from "@/components/cat/tokens";
import { Lives } from "@/components/perp/Lives";
import { nickname, useNames } from "@/lib/names";
import {
  lifeWords,
  perpLabel,
  perpLeverages,
  playerOf,
  points,
  times,
  type PerpSummary,
} from "@/lib/perp";

const $ = (base: bigint) => {
  const n = Number(base) / 1e6;
  return `$${n === 0 || n >= 0.01 ? n.toFixed(2) : String(Number(n.toPrecision(2)))}`;
};

/** The "Perp" tag next to a row (normal pots carry "Normal"). */
export function KindTag({ kind }: { kind: "Normal" | "Perp" }) {
  return (
    <span
      style={{
        border: `1.5px solid ${kind === "Perp" ? C.signal : C.ink}`,
        color: kind === "Perp" ? C.signalInk : C.ink,
        padding: "0 6px",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: "0.02em",
      }}
    >
      {kind}
    </span>
  );
}

function phaseWords(p: PerpSummary) {
  switch (p.phase) {
    case "Open":
      return "waiting for someone";
    case "Funded":
    case "Joining":
      return "first rope starting";
    case "Running":
      return `rope ${p.data.ropes} running`;
    default:
      return `ended after ${p.data.ropes} ${p.data.ropes === 1 ? "rope" : "ropes"}`;
  }
}

/** Perps as list rows: market, label with both leverages, stake per rope, lives, state. */
export function PerpRows({
  perps,
  me,
  offer,
}: {
  perps: PerpSummary[];
  me?: string | null;
  offer?: boolean;
}) {
  const names = useNames(perps.flatMap((p) => [p.a, p.b]));
  return (
    <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
      {perps.map((p) => {
        const lev = perpLeverages(p);
        const mine = playerOf(p, me);
        const stake = BigInt(p.data.stake);
        const creatorYes = p.data.t.creatorSide === 0;
        const lives =
          mine === "b" ? Number(p.data.livesB) : Number(p.data.livesA);
        return (
          <Link
            key={p.perpId}
            href={`/perps/${p.perpId}`}
            className="hc-row"
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "4px 20px",
              alignItems: "baseline",
              padding: "14px 6px",
              borderBottom: `1px solid ${C.faint}`,
              textDecoration: "none",
              color: C.ink,
            }}
          >
            <span
              style={{
                fontFamily: F.cond,
                fontSize: 22,
                fontWeight: 600,
                minWidth: 48,
              }}
            >
              P{p.perpId}
            </span>
            <span
              style={{
                fontSize: 17,
                fontWeight: 600,
                flex: "1 1 280px",
                display: "flex",
                gap: 8,
                alignItems: "baseline",
                flexWrap: "wrap",
              }}
            >
              <KindTag kind="Perp" />
              {p.market
                ? `${p.market.eventTitle}${p.market.label && p.market.label !== "Yes" ? `: ${p.market.label}` : ""}`
                : "Unknown market"}
            </span>
            <span style={{ fontSize: 16 }}>
              {lev
                ? perpLabel(p.data.t.d, lev.creator, lev.joiner)
                : `Perp, rope ${points(p.data.t.d)} points`}
            </span>
            <span style={{ fontSize: 16, fontVariantNumeric: "tabular-nums" }}>
              {$(stake)} per rope
            </span>
            <span style={{ fontSize: 14, color: C.muted }}>
              {phaseWords(p)} · ropes up to{" "}
              {lifeWords(Number(p.data.t.ropeLife))}
            </span>
            {offer && lev && (
              <span style={{ fontSize: 15, color: C.muted }}>
                take {creatorYes ? "NO" : "YES"} at {times(lev.joiner)} ·{" "}
                <CatName
                  account={p.a}
                  name={names[p.a.toLowerCase()] ?? nickname(p.a.toLowerCase())}
                />{" "}
                waits with {Number(p.data.livesA)}{" "}
                {Number(p.data.livesA) === 1 ? "life" : "lives"}
              </span>
            )}
            {mine && p.phase !== "Ended" && (
              <span
                style={{
                  display: "inline-flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: 15,
                  color: C.muted,
                }}
              >
                you: <Lives left={lives} size={16} max={9} />
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
