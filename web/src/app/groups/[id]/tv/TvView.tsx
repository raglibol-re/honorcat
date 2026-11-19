"use client";

import { CatState } from "@/components/cat/CatState";
import { Rope } from "@/components/pot/Rope";
import { useLivePrice } from "@/components/pot/usePrice";
import { BigScreen } from "@/components/tv/BigScreen";
import { usePolling } from "@/lib/api";
import { money } from "@/lib/currency";
import { groupEventText, groupPath, P, type GroupDetail } from "@/lib/group";
import { displayName, useNames } from "@/lib/names";
import { SITE_URL } from "@/lib/site";
import { useNow } from "@/lib/useNow";

/** A group for the big screen: the rope with both teams' cats and member counts, a join QR per team, the newest events. */
export function GroupTvView({ id }: { id: string }) {
  const { data: g, error } = usePolling<GroupDetail>(groupPath(id), 3000);
  const live = useLivePrice(g && g.state === "Open" ? (g.market?.instrument ?? null) : null);
  const names = useNames((g?.events ?? []).flatMap((e) => [e.args.account, e.args.creator]));
  const nowMs = useNow();
  if (!g) return error ? <CatState kind="error" plain={/404|not found|no such|private/i.test(error)} text={(/404|not found|no such/i.test(error) ? "There is nothing at this address. Check the link." : /private/i.test(error) ? "This pot is private: open it from its private link." : error)} size={300} /> : <CatState kind="loading" text={`Reading group ${id} from Arc…`} size={300} />;
  const [a, b] = g.names;
  const last = g.prices.length ? g.prices[g.prices.length - 1]!.price : null;
  const settled = g.state === "Settled";
  const price = settled ? (g.outcome === 1 ? 1 : g.outcome === 0 ? 0 : null) : (live.smoothed ?? (last !== null ? last / P : null));
  const who = (x: string) => displayName(x, names, null, false);
  const events = (g.events ?? []).map((e) => groupEventText(e, g.names, who, money)).filter((x): x is string => !!x);
  const open = g.state === "Open" && nowMs / 1000 + 120 < g.closeTime;
  return (
    <BigScreen
      home={`/groups/${id}`}
      title={`${a} vs ${b}`}
      line={g.market ? `${g.market.eventTitle}${g.market.label ? ` · ${g.market.label}` : ""}: ${a} hold the yes side, ${b} the no side.` : null}
      rope={
        <Rope
          price={price}
          notional={BigInt(g.teams[0]?.pool ?? "0")}
          names={{ yes: a, no: b }}
          phase={settled ? "settled" : g.state === "Open" ? "live" : "expired"}
          receiver={settled ? (g.outcome === 1 ? 0 : g.outcome === 0 ? 1 : 2) : null}
          trail={live.trail}
          speed={live.speed}
          big
          cats={{
            yes: { fur: "ginger", mood: "even", name: `${a} · ${g.teams[0]?.members ?? 0} cats` },
            no: { fur: "grey", mood: "even", name: `${b} · ${g.teams[1]?.members ?? 0} cats` },
          }}
        />
      }
      reactionsKey={String(9_000_000_000 + Number(g.groupId))}
      watchKey={`g${g.groupId}`}
      qrs={open ? [0, 1].map((t) => ({ label: `Join ${g.names[t]}`, url: `${SITE_URL}/groups/${g.groupId}?team=${t}` })) : [{ label: "Scan to watch", url: `${SITE_URL}/groups/${g.groupId}` }]}
      events={events}
    />
  );
}
