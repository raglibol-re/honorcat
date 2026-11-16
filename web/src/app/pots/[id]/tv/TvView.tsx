"use client";

import Link from "next/link";
import { Cat } from "@/components/cat/Cat";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { Rope } from "@/components/pot/Rope";
import { sceneOf, STATE_TEXT } from "@/components/pot/scene";
import { marketTitle } from "@/lib/marketName";
import { useNames } from "@/lib/names";
import { useLivePrice } from "@/components/pot/usePrice";
import { usePolling } from "@/lib/api";
import type { HcPot } from "@/lib/hc";
import { useNow } from "@/lib/useNow";

/** The pot for a big screen: the rope fills the room, nothing to click. */
export function TvView({ id }: { id: string }) {
  const { data: pot } = usePolling<HcPot>(`/api/hc/pots/${id}`, 3000);
  const live = useLivePrice(pot?.market?.instrument ?? null, Number(pot?.data.window ?? 30));
  const nowS = Math.floor(useNow() / 1000);
  const names = useNames([pot?.owners.yes, pot?.owners.no, pot?.data.joiner]);
  return (
    <div className="hc" style={{ minHeight: "100vh", background: C.page, color: C.ink, display: "flex", flexDirection: "column", padding: "3vh 4vw", boxSizing: "border-box", gap: "3vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
        <Link href={`/pots/${id}`} style={{ display: "flex", alignItems: "center", gap: 14, textDecoration: "none" }}>
          <CatHead width={48} height={45} eyes={C.signal} />
          <span style={{ fontFamily: F.cond, fontSize: 44, fontWeight: 600 }}>HonorCat</span>
        </Link>
        <span style={{ fontSize: 22, color: C.muted }}>Arc testnet · test money only · not financial advice</span>
      </header>
      {!pot ? (
        <Cat pose="peek" size={300} />
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(48px, 6vw, 110px)", fontWeight: 600, lineHeight: 0.95 }}>
              {pot.market ? marketTitle(pot.market) : `Pot ${id}`}
            </h1>
            <p style={{ margin: 0, fontSize: 28, color: C.body }}>{STATE_TEXT[pot.state]}</p>
          </div>
          <Rope {...sceneOf(pot, live.smoothed, nowS, { names })} trail={live.trail} speed={live.speed} big />
        </>
      )}
    </div>
  );
}
