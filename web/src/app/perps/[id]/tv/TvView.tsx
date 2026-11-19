"use client";

import { CatState } from "@/components/cat/CatState";
import { Rope } from "@/components/pot/Rope";
import { useLivePrice } from "@/components/pot/usePrice";
import { BigScreen } from "@/components/tv/BigScreen";
import { usePolling } from "@/lib/api";
import { money } from "@/lib/currency";
import { displayName, furOf, useNames } from "@/lib/names";
import { livesOf, type PerpDetail, type RopeStory } from "@/lib/perp";
import { SITE_URL } from "@/lib/site";

const REASONS = ["someone left", "knocked out at a post", "time was up", "both agreed a price", "the market settled", "deposits went back"];

/** A perp for the big screen: the running rope, both players' lives, a QR code, the newest ropes. */
export function PerpTvView({ id }: { id: string }) {
  const { data: p, error } = usePolling<PerpDetail>(`/api/hc/perps/${id}`, 3000);
  const { data: r } = usePolling<{ ropes: RopeStory[] }>(`/api/hc/perps/${id}/ropes`, 10_000);
  const live = useLivePrice(p && p.phase !== "Ended" ? (p.market?.instrument ?? null) : null);
  const names = useNames([p?.a, p?.b]);
  if (!p) return error ? <CatState kind="error" text={(/404|not found|no such/i.test(error) ? "There is nothing at this address. Check the link." : /private/i.test(error) ? "This pot is private: open it from its private link." : error)} size={300} /> : <CatState kind="loading" text={`Reading perp ${id} from Arc…`} size={300} />;
  const d = p.data;
  const stake = BigInt(d.stake);
  const running = p.phase === "Running" || p.phase === "Joining";
  const nm = (a: string | null) => displayName(a, names, null, false);
  const livesA = livesOf(BigInt(d.freeA), stake, running);
  const livesB = livesOf(BigInt(d.freeB), stake, running);
  const rope = r?.ropes.at(-1) ?? null;
  const aYes = d.t.creatorSide === 0;
  const yesAcct = aYes ? p.a : p.b;
  const noAcct = aYes ? p.b : p.a;
  const events = (p.events ?? [])
    .filter((e) => e.name === "RopeCredited" || e.name === "PerpJoined" || e.name === "PerpEnded")
    .map((e) => {
      if (e.name === "PerpJoined") return `${nm(p.b)} took the other side`;
      if (e.name === "PerpEnded") return "The perp ended: spare money back to both";
      const reason = REASONS[Number(e.args.reason)] ?? "ended";
      return `A rope ended (${reason}): ${nm(p.a)} got ${money(e.args.paidA ?? "0")}, ${nm(p.b)} ${money(e.args.paidB ?? "0")}`;
    })
    .reverse();
  return (
    <BigScreen
      home={`/perps/${id}`}
      title={p.market ? `${p.market.eventTitle}${p.market.label ? ` · ${p.market.label}` : ""}` : `Perp ${id}`}
      line={`${nm(p.a)}: ${livesA} ${livesA === 1 ? "life" : "lives"} · ${nm(p.b)}: ${livesB} ${livesB === 1 ? "life" : "lives"} · rope ${d.ropes}, a life is ${money(stake)}`}
      rope={
        running && rope && rope.upper > rope.lower ? (
          <Rope
            price={live.smoothed}
            notional={stake * 2n}
            names={{ yes: nm(yesAcct), no: nm(noAcct) }}
            phase="live"
            posts={{ lower: rope.lower / 1e6, upper: rope.upper / 1e6 }}
            zoom={[Math.max(0, rope.lower / 1e6 - (rope.upper - rope.lower) / 4e6), Math.min(1, rope.upper / 1e6 + (rope.upper - rope.lower) / 4e6)]}
            trail={live.trail}
            speed={live.speed}
            big
            cats={{ yes: { fur: furOf(yesAcct), mood: "even", name: nm(yesAcct) }, no: { fur: furOf(noAcct), mood: "even", name: nm(noAcct) } }}
          />
        ) : (
          <p style={{ margin: 0, fontSize: 34 }}>{p.phase === "Ended" ? "This perp has ended." : "Waiting for the first rope."}</p>
        )
      }
      reactionsKey={`-${id}`}
      watchKey={`-${id}`}
      qrs={[{ label: p.phase === "Open" ? "Scan to take the other side" : "Scan to watch", url: `${SITE_URL}/perps/${id}` }]}
      events={events}
    />
  );
}
