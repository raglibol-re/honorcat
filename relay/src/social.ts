import { getAddress, type Address, type Hex } from "viem";
import { publicClient } from "./chain";
import type { Db } from "./db";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";

/**
 * Following and the feed (spec "groups, the social loop, copycat and incentives", section 4), and
 * streaks (section 5). A follow is signed by the follower (wallet signature or one passkey
 * confirmation), moves no money and authorises nothing; follows are public.
 */
const NOT_PRACTICE = `(NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = e.pot_id) AND NOT EXISTS (SELECT 1 FROM seat_pots sp WHERE sp.pot_id = e.pot_id))`;

export const followMessage = (leader: string, follow: boolean, account: string, issuedAt: string) =>
  `HonorCat: ${follow ? "follow" : "stop following"} ${getAddress(leader)}.\nAccount: ${getAddress(account)}\nIssued: ${issuedAt}`;

export async function setFollow(
  db: Db,
  input: { account: Address; leader: Address; follow: boolean; issuedAt: string } & ({ signature: Hex } | { passkey: WebAuthnAssertion }),
) {
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  const account = getAddress(input.account);
  const leader = getAddress(input.leader);
  if (account === leader) throw Object.assign(new Error("you cannot follow yourself"), { status: 400 });
  const message = followMessage(leader, input.follow, account, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else {
    await verifyPasskeyJoin(db, account, message, input.passkey);
  }
  if (input.follow) {
    const n = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM follows WHERE follower = $1", [account.toLowerCase()]);
    if (Number(n[0]?.n ?? 0) >= 200) throw Object.assign(new Error("you follow 200 players already"), { status: 409 });
    await db.query("INSERT INTO follows (follower, leader) VALUES ($1, $2) ON CONFLICT DO NOTHING", [account.toLowerCase(), leader.toLowerCase()]);
  } else {
    await db.query("DELETE FROM follows WHERE follower = $1 AND leader = $2", [account.toLowerCase(), leader.toLowerCase()]);
  }
  return followsOf(db, account);
}

/** Who an account follows, and how many follow it. */
export async function followsOf(db: Db, account: string) {
  const a = account.toLowerCase();
  const following = (await db.query<{ leader: string }>("SELECT leader FROM follows WHERE follower = $1 ORDER BY at DESC", [a])).map((r) => r.leader);
  const followers = Number((await db.query<{ n: string }>("SELECT count(*)::text AS n FROM follows WHERE leader = $1", [a]))[0]?.n ?? 0);
  return { account: a, following, followers };
}

export type FeedItem = {
  kind: "pot" | "perp";
  id: string;
  leader: string;
  side: number | null;
  at: number | null;
  state: string;
  /** For a live v2 pot: the copy token (chain pot id × 2 + side), so the feed can offer "copy". */
  copyToken: string | null;
  entryPpm: number | null;
  conditionId: string | null;
};

const POT_STATES = ["None", "Open", "Joining", "Live", "ExitRequested", "Divided", "Settled", "Expired"];
const PERP_PHASES = ["None", "Open", "Funded", "Joining", "Running", "Ended"];

/**
 * New pots and perps of the players an account follows (last 14 days, newest first): the pots they
 * got a side of (Transfer from zero) and the perps they opened or joined. Practice pots excluded.
 */
export async function feedOf(db: Db, account: string, limit = 40): Promise<(FeedItem & { market: { title: string; label: string; instrument: string } | null })[]> {
  const a = account.toLowerCase();
  const since = Math.floor(Date.now() / 1000) - 14 * 86_400;
  const pots = await db.query<{ pot_id: string; leader: string; token: string; at: string | null; state: number; data: Record<string, unknown> | string; condition_id: string }>(
    `SELECT e.pot_id::text AS pot_id, lower(e.args->>'to') AS leader, e.args->>'tokenId' AS token, e.block_time::text AS at, p.state, p.data, p.condition_id
       FROM pot_events e JOIN pots p ON p.pot_id = e.pot_id
      WHERE e.event_name = 'Transfer' AND e.args->>'from' ~* '^0x0{40}$' AND coalesce(e.block_time, 0) >= $2
        AND lower(e.args->>'to') IN (SELECT leader FROM follows WHERE follower = $1) AND ${NOT_PRACTICE}
      ORDER BY e.block_number DESC LIMIT $3`,
    [a, since, limit],
  );
  const perps = await db.query<{ perp_id: string; leader: string; at: string | null; phase: number; data: Record<string, unknown> | string; side: string | null }>(
    `SELECT e.args->>'perpId' AS perp_id, lower(coalesce(e.args->>'creator', e.args->>'joiner')) AS leader, e.block_time::text AS at, q.phase, q.data, e.args->>'side' AS side
       FROM pot_events e JOIN perps q ON q.perp_id::text = e.args->>'perpId'
      WHERE e.event_name IN ('Perp:PerpOpened', 'Perp:PerpJoined') AND coalesce(e.block_time, 0) >= $2
        AND lower(coalesce(e.args->>'creator', e.args->>'joiner')) IN (SELECT leader FROM follows WHERE follower = $1)
        AND NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = -q.perp_id)
      ORDER BY e.block_number DESC LIMIT $3`,
    [a, since, limit],
  );
  const items: FeedItem[] = [];
  for (const r of pots) {
    const d = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, string | boolean>;
    const side = Number(BigInt(r.token) % 2n);
    const v2 = d.v2 === true;
    const live = r.state === 3;
    items.push({
      kind: "pot",
      id: r.pot_id,
      leader: r.leader,
      side,
      at: r.at ? Number(r.at) : null,
      state: POT_STATES[r.state] ?? "None",
      copyToken: v2 && live && d.chainPotId ? (BigInt(String(d.chainPotId)) * 2n + BigInt(side)).toString() : null,
      entryPpm: d.entry ? Number(d.entry) : null,
      conditionId: r.condition_id,
    });
  }
  for (const r of perps) {
    const q = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as { t?: { conditionId?: string; creatorSide?: number } };
    const creatorSide = Number(q.t?.creatorSide ?? 0);
    const isCreator = r.side !== null;
    items.push({
      kind: "perp",
      id: r.perp_id,
      leader: r.leader,
      side: isCreator ? creatorSide : 1 - creatorSide,
      at: r.at ? Number(r.at) : null,
      state: PERP_PHASES[r.phase] ?? "None",
      copyToken: null,
      entryPpm: null,
      conditionId: q.t?.conditionId ?? null,
    });
  }
  const ids = [...new Set(items.map((i) => i.conditionId?.toLowerCase()).filter((x): x is string => !!x))];
  const markets = ids.length
    ? await db.query<{ c: string; title: string; label: string; instrument: string }>(
        "SELECT lower(condition_id) AS c, event_title AS title, label, instrument FROM pot_markets WHERE lower(condition_id) = ANY($1::text[])",
        [ids],
      )
    : [];
  const byId = new Map(markets.map((m) => [m.c, m]));
  return items
    .map((i) => {
      const m = i.conditionId ? byId.get(i.conditionId.toLowerCase()) : undefined;
      return { ...i, market: m ? { title: m.title, label: m.label, instrument: m.instrument } : null };
    })
    .sort((x, y) => (y.at ?? 0) - (x.at ?? 0))
    .slice(0, limit);
}

/**
 * Playing streaks: consecutive UTC days with a new pot side or a perp opened or joined. `current`
 * counts back from today (or yesterday, so a streak is not lost before today's first pot); `best`
 * is the longest run. Practice pots count (a streak is about coming back, not about money).
 */
export async function streaksOf(db: Db, accounts: string[]): Promise<Record<string, { current: number; best: number; days: number }>> {
  const list = [...new Set(accounts.map((x) => x.toLowerCase()).filter((x) => /^0x[0-9a-f]{40}$/.test(x)))].slice(0, 50);
  const out: Record<string, { current: number; best: number; days: number }> = {};
  for (const x of list) out[x] = { current: 0, best: 0, days: 0 };
  if (!list.length) return out;
  const rows = await db.query<{ account: string; day: string }>(
    `SELECT DISTINCT account, day FROM (
       SELECT lower(args->>'to') AS account, (to_timestamp(block_time) AT TIME ZONE 'UTC')::date::text AS day FROM pot_events
        WHERE event_name = 'Transfer' AND args->>'from' ~* '^0x0{40}$' AND block_time IS NOT NULL AND lower(args->>'to') = ANY($1::text[])
       UNION ALL
       SELECT lower(coalesce(args->>'creator', args->>'joiner')), (to_timestamp(block_time) AT TIME ZONE 'UTC')::date::text FROM pot_events
        WHERE event_name IN ('Perp:PerpOpened', 'Perp:PerpJoined') AND block_time IS NOT NULL AND lower(coalesce(args->>'creator', args->>'joiner')) = ANY($1::text[])
     ) d ORDER BY account, day`,
    [list],
  );
  const byAcc = new Map<string, number[]>();
  for (const r of rows) {
    const n = Math.floor(Date.parse(`${r.day}T00:00:00Z`) / 86_400_000);
    byAcc.set(r.account, [...(byAcc.get(r.account) ?? []), n]);
  }
  const today = Math.floor(Date.now() / 86_400_000);
  for (const [acc, days] of byAcc) {
    let best = 0;
    let run = 0;
    for (let i = 0; i < days.length; i++) {
      run = i > 0 && days[i] === days[i - 1]! + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    const last = days.at(-1)!;
    const current = last >= today - 1 ? run : 0;
    out[acc] = { current, best, days: days.length };
  }
  return out;
}

/**
 * How many pots, perps (and later group joins) an account started in the last three hours: the
 * break reminder after several in a row.
 */
export async function recentPlays(db: Db, account: string) {
  const a = account.toLowerCase();
  const since = Math.floor(Date.now() / 1000) - 3 * 3600;
  const r = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pot_events
      WHERE coalesce(block_time, 0) >= $2 AND (
        (event_name = 'Transfer' AND args->>'from' ~* '^0x0{40}$' AND lower(args->>'to') = $1)
        OR (event_name IN ('Perp:PerpOpened', 'Perp:PerpJoined') AND lower(coalesce(args->>'creator', args->>'joiner')) = $1))`,
    [a, since],
  );
  return { account: a, lastThreeHours: Number(r[0]?.n ?? 0) };
}
