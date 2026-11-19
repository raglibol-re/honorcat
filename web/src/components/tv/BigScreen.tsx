"use client";

import Link from "next/link";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { InviteQR } from "@/components/pot/InviteQR";
import { Reactions } from "@/components/pot/Reactions";
import { Watching } from "@/components/pot/Watching";

/**
 * The big screen for a bar, a watch party or the pitch: the rope fills the room, live reactions,
 * how many watch, a large join QR code per seat or team, and the newest events in large plain words.
 * Nothing to click.
 */
export function BigScreen({
  home,
  title,
  line,
  rope,
  reactionsKey,
  watchKey,
  qrs,
  events,
}: {
  home: string;
  title: string;
  line?: string | null;
  rope: React.ReactNode;
  reactionsKey: string;
  watchKey: string;
  qrs: { label: string; url: string }[];
  events: string[];
}) {
  return (
    <div className="hc" style={{ minHeight: "100vh", background: C.page, color: C.ink, display: "flex", flexDirection: "column", padding: "3vh 4vw", boxSizing: "border-box", gap: "2.5vh", overflowX: "hidden", maxWidth: "100vw" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <Link href={home} style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}>
          <CatHead width={48} height={45} eyes={C.signal} />
          <span style={{ fontFamily: F.cond, fontSize: 44, fontWeight: 600 }}>HonorCat</span>
        </Link>
        <Watching watchKey={watchKey} big player />
        <span style={{ fontSize: 22, color: C.muted }}>Arc testnet · test money only · not financial advice</span>
      </header>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 5.5vw, 104px)", fontWeight: 600, lineHeight: 0.95 }}>{title}</h1>
        {line && <p style={{ margin: 0, fontSize: 28, color: C.body }}>{line}</p>}
      </div>
      {rope}
      <div style={{ fontSize: 28 }}>
        <Reactions potId={reactionsKey} />
      </div>
      <div style={{ display: "flex", gap: "4vw", alignItems: "flex-start", flexWrap: "wrap" }}>
        {qrs.map((q) => (
          <figure key={q.url} style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <InviteQR url={q.url} size={200} label={q.label} />
            <figcaption style={{ fontFamily: F.cond, fontSize: 30, fontWeight: 600 }}>{q.label}</figcaption>
          </figure>
        ))}
        {events.length > 0 && (
          <ol aria-label="Latest" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10, flex: "1 1 280px", minWidth: 0, overflowWrap: "anywhere", fontSize: "clamp(20px, 2.4vw, 30px)", lineHeight: 1.3 }}>
            {events.slice(0, 5).map((e, i) => (
              <li key={i} style={{ opacity: 1 - i * 0.15 }}>
                {e}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
