import "server-only";
import { getDb, pots } from "./relay";
import { catalogList } from "./catalog";

export type HomeData = {
  /** The pot the landing shows: the newest running one (live first), else none. */
  potId: string | null;
  /** Without a running pot: a liquid market to show an example rope on. */
  market: { symbol: string; title: string; label: string; closeMs: number } | null;
};

/** Picks what the landing shows: one live pot, or an example on a liquid Gemini market. */
export async function homeData(): Promise<HomeData> {
  const db = await getDb();
  const running = await pots.listPotsHc(db, { states: [3, 4, 2], limit: 20 }).catch(() => []);
  const now = Date.now();
  const pick = running.find((p) => p.state === "Live" || p.state === "ExitRequested") ?? running.find((p) => Number(p.data.closeTime) * 1000 > now);
  if (pick) return { potId: pick.potId, market: null };
  const list = await catalogList(db, { usable: true, limit: 60 }).catch(() => null);
  const m = list?.items.find((x) => {
    const bid = x.book?.bid ?? x.bid;
    const ask = x.book?.ask ?? x.ask;
    return bid !== null && ask !== null && bid > 0.2 && ask < 0.8 && x.closeMs - now > 3600_000;
  });
  return { potId: null, market: m ? { symbol: m.symbol, title: m.eventTitle, label: m.label, closeMs: m.closeMs } : null };
}
