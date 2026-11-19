"use client";

import { useSearchParams } from "next/navigation";
import { CatState } from "@/components/cat/CatState";
import { Rope } from "@/components/pot/Rope";
import { sceneOf, STATE_TEXT, storyOf } from "@/components/pot/scene";
import { useLivePrice } from "@/components/pot/usePrice";
import { BigScreen } from "@/components/tv/BigScreen";
import { usePolling } from "@/lib/api";
import type { HcPot } from "@/lib/hc";
import { marketTitle } from "@/lib/marketName";
import { displayName, useNames } from "@/lib/names";
import { SITE_URL } from "@/lib/site";
import { useNow } from "@/lib/useNow";

/** The pot for a big screen: the rope fills the room, reactions, a QR code, the newest events. */
export function TvView({ id }: { id: string }) {
  const k = useSearchParams().get("k");
  const { data: pot } = usePolling<HcPot>(`/api/hc/pots/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`, 3000);
  const closed = pot ? pot.state === "Divided" || pot.state === "Settled" || pot.state === "Expired" : false;
  const live = useLivePrice(closed ? null : (pot?.market?.instrument ?? null), Number(pot?.data.window ?? 30));
  const nowS = Math.floor(useNow() / 1000);
  const names = useNames([pot?.owners.yes, pot?.owners.no, pot?.data.joiner, ...(pot?.events ?? []).flatMap((e) => [e.args.creator, e.args.joiner, e.args.to, e.args.from])]);
  if (!pot) return <CatState kind="loading" text="Reading the pot from Arc…" size={300} />;
  const nm = (a: string | null) => displayName(a, names, null, false);
  const events = storyOf(pot, nm)
    .map((x) => x.text)
    .reverse();
  const url = `${SITE_URL}/pots/${id}${k ? `?k=${encodeURIComponent(k)}` : ""}`;
  return (
    <BigScreen
      home={`/pots/${id}`}
      title={pot.market ? marketTitle(pot.market) : `Pot ${id}`}
      line={STATE_TEXT[pot.state]}
      rope={<Rope {...sceneOf(pot, live.smoothed, nowS, { names })} trail={live.trail} speed={live.speed} big />}
      reactionsKey={String(pot.potId)}
      watchKey={String(pot.potId)}
      qrs={[{ label: pot.state === "Open" ? "Scan to take the other side" : "Scan to watch on your phone", url }]}
      events={events}
    />
  );
}
