/**
 * Treats and the leaderboard (HonorCat v2, spec sections 7, 10 and 11), read from the contract's own
 * events (pot_events). Every treat is a share of a fee another player paid: maker treats, exit fees,
 * referral shares and copycat treats. Practice pots and Grok Bot seats never count.
 */
import type { Db } from "./db";

const TREATS = ["MakerTreat", "ExitFee", "ReferralTreat", "CopycatTreat"] as const;
export type TreatKind = (typeof TREATS)[number];
const NOT_PRACTICE = `(e.pot_id IS NULL OR (NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = e.pot_id) AND NOT EXISTS (SELECT 1 FROM seat_pots sp WHERE sp.pot_id = e.pot_id)))`;
const RECIPIENT = `lower(coalesce(e.args->>'to', e.args->>'referrer', e.args->>'leader'))`;

/** An account's treats: every one with its pot, payer and transaction, and the totals per kind. */
export async function treatsOf(db: Db, account: string) {
  const a = account.toLowerCase();
  const rows = await db.query<{ event_name: TreatKind; pot_id: string | null; args: Record<string, string>; tx_hash: string; block_time: string | null }>(
    `SELECT e.event_name, e.pot_id::text AS pot_id, e.args, e.tx_hash, e.block_time::text AS block_time FROM pot_events e
      WHERE e.event_name = ANY($2::text[]) AND ${RECIPIENT} = $1 AND ${NOT_PRACTICE}
      ORDER BY e.block_number DESC, e.log_index DESC LIMIT 200`,
    [a, TREATS],
  );
  const totals: Record<TreatKind, bigint> = { MakerTreat: 0n, ExitFee: 0n, ReferralTreat: 0n, CopycatTreat: 0n };
  for (const r of rows) totals[r.event_name] += BigInt(r.args.amount ?? "0");
  const followers = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM pot_events e WHERE e.event_name = 'CopyMarked' AND lower(e.args->>'leader') = $1", [a]);
  const referred = await db.query<{ n: string }>("SELECT count(DISTINCT lower(e.args->>'payer'))::text AS n FROM pot_events e WHERE e.event_name = 'ReferralTreat' AND lower(e.args->>'referrer') = $1", [a]);
  return {
    account: a,
    total: Object.values(totals).reduce((s, v) => s + v, 0n).toString(),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, v.toString()])),
    copycats: Number(followers[0]?.n ?? 0),
    referred: Number(referred[0]?.n ?? 0),
    items: rows.map((r) => ({
      kind: r.event_name,
      potId: r.pot_id,
      amount: r.args.amount ?? "0",
      from: (r.args.payer ?? "").toLowerCase(),
      tx: r.tx_hash,
      at: r.block_time ? Number(r.block_time) : null,
      profit: r.args.profit ?? null,
    })),
  };
}

/** Players this account has met in a pot (either side), for the friends view. */
async function friendsOf(db: Db, account: string): Promise<string[]> {
  const a = account.toLowerCase();
  const rows = await db.query<{ f: string }>(
    `SELECT DISTINCT CASE WHEN yes_owner = $1 THEN no_owner ELSE yes_owner END AS f FROM pots
      WHERE (yes_owner = $1 OR no_owner = $1) AND yes_owner IS NOT NULL AND no_owner IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = pots.pot_id)`,
    [a],
  );
  return [a, ...rows.map((r) => r.f).filter(Boolean)];
}

/**
 * The leaderboard over the last `days` days (0 = all time): pots played, held to the end, paid out,
 * treats earned and how many players copy them. With `friendsOf`, only that player and the players
 * they have met in a pot.
 */
export async function leaderboard(db: Db, opts: { days?: number; friendsOf?: string | null; limit?: number } = {}) {
  const since = opts.days && opts.days > 0 ? Math.floor(Date.now() / 1000) - opts.days * 86_400 : 0;
  const only = opts.friendsOf ? await friendsOf(db, opts.friendsOf) : null;
  const rows = await db.query<{ account: string; pots: string; held: string; paid: string; treats: string; copycats: string }>(
    `WITH ev AS (SELECT * FROM pot_events e WHERE coalesce(e.block_time, 0) >= $1 AND ${NOT_PRACTICE}),
     played AS (SELECT lower(args->>'to') AS account, count(DISTINCT pot_id) AS n FROM ev WHERE event_name = 'Transfer' AND args->>'from' ~* '^0x0{40}$' GROUP BY 1),
     held AS (SELECT lower(t.args->>'to') AS account, count(DISTINCT s.pot_id) AS n FROM ev s JOIN pot_events t ON t.pot_id = s.pot_id AND t.event_name = 'Transfer'
              WHERE s.event_name = 'PotSettled' GROUP BY 1),
     paid AS (SELECT lower(args->>'to') AS account, sum((args->>'amount')::numeric) AS n FROM ev WHERE event_name = 'Paid' GROUP BY 1),
     treats AS (SELECT lower(coalesce(args->>'to', args->>'referrer', args->>'leader')) AS account, sum((args->>'amount')::numeric) AS n FROM ev
                WHERE event_name IN ('MakerTreat','ExitFee','ReferralTreat','CopycatTreat') GROUP BY 1),
     copied AS (SELECT lower(args->>'leader') AS account, count(*) AS n FROM ev WHERE event_name = 'CopyMarked' GROUP BY 1)
     SELECT p.account, p.n::text AS pots, coalesce(h.n, 0)::text AS held, coalesce(pd.n, 0)::text AS paid, coalesce(t.n, 0)::text AS treats, coalesce(c.n, 0)::text AS copycats
       FROM played p LEFT JOIN held h USING (account) LEFT JOIN paid pd USING (account) LEFT JOIN treats t USING (account) LEFT JOIN copied c USING (account)
      WHERE ($2::text[] IS NULL OR p.account = ANY($2::text[]))
      ORDER BY p.n DESC, coalesce(t.n, 0) DESC, coalesce(h.n, 0) DESC LIMIT $3`,
    [since, only, opts.limit ?? 50],
  );
  return {
    since: since || null,
    friendsOf: opts.friendsOf?.toLowerCase() ?? null,
    rows: rows.map((r) => ({ account: r.account, pots: Number(r.pots), heldToEnd: Number(r.held), paid: r.paid, treats: r.treats, copycats: Number(r.copycats) })),
  };
}

/**
 * The perp table: per player, net result over the perps both players joined (practice perps do not
 * count), perps played and won, ropes played and lives lost (ropes that paid the player nothing).
 * `days` counts perps opened in that period; ordered by net result.
 */
export async function perpLeaderboard(db: Db, opts: { days?: number; friendsOf?: string | null; limit?: number } = {}) {
  const since = opts.days && opts.days > 0 ? Math.floor(Date.now() / 1000) - opts.days * 86_400 : 0;
  const only = opts.friendsOf ? await friendsOf(db, opts.friendsOf) : null;
  const rows = await db.query<{ account: string; perps: string; won: string; ropes: string; lost: string; result: string }>(
    `WITH opened AS (SELECT args->>'perpId' AS perp_id, min(coalesce(block_time, 0)) AS at FROM pot_events WHERE event_name = 'Perp:PerpOpened' GROUP BY 1),
     p AS (SELECT q.perp_id, q.a, q.b, q.data FROM perps q JOIN opened o ON o.perp_id = q.perp_id::text
            WHERE q.b IS NOT NULL AND o.at >= $1
              AND NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = -q.perp_id)),
     lost AS (SELECT args->>'perpId' AS perp_id,
                     count(*) FILTER (WHERE args->>'paidA' = '0') AS la, count(*) FILTER (WHERE args->>'paidB' = '0') AS lb
                FROM pot_events WHERE event_name = 'Perp:RopeCredited' GROUP BY 1),
     sides AS (SELECT lower(p.a) AS account, (p.data->>'resultA')::numeric AS r, coalesce((p.data->>'ropes')::int, 0) AS ropes, coalesce(l.la, 0) AS lost
                 FROM p LEFT JOIN lost l ON l.perp_id = p.perp_id::text
               UNION ALL
               SELECT lower(p.b), (p.data->>'resultB')::numeric, coalesce((p.data->>'ropes')::int, 0), coalesce(l.lb, 0)
                 FROM p LEFT JOIN lost l ON l.perp_id = p.perp_id::text)
     SELECT account, count(*)::text AS perps, count(*) FILTER (WHERE r > 0)::text AS won, sum(ropes)::text AS ropes,
            sum(lost)::text AS lost, sum(r)::text AS result
       FROM sides WHERE ($2::text[] IS NULL OR account = ANY($2::text[]))
      GROUP BY account ORDER BY sum(r) DESC, count(*) DESC LIMIT $3`,
    [since, only, opts.limit ?? 50],
  );
  return {
    since: since || null,
    friendsOf: opts.friendsOf?.toLowerCase() ?? null,
    rows: rows.map((r) => ({ account: r.account, perps: Number(r.perps), won: Number(r.won), ropes: Number(r.ropes), livesLost: Number(r.lost), result: r.result })),
  };
}

/**
 * Head to head between two players: every finished pot where one held YES and the other NO (not
 * practice, not agent seats), and who came out ahead in each: what each side was paid in all, less
 * what it put in when the pot was joined. Newest first.
 */
export async function rivalry(db: Db, a: string, b: string) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return { a: x, b: y, played: 0, aAhead: 0, bAhead: 0, even: 0, pots: [] as { potId: string; aNet: string; bNet: string }[] };
  const rows = await db.query<{ pot_id: string; yes: string; no: string; yes_net: string; no_net: string }>(
    `WITH p AS (SELECT pot_id, lower(yes_owner) AS yes, lower(no_owner) AS no FROM pots
                 WHERE state IN (5, 6, 7) AND ((lower(yes_owner) = $1 AND lower(no_owner) = $2) OR (lower(yes_owner) = $2 AND lower(no_owner) = $1))
                   AND NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = pots.pot_id)
                   AND NOT EXISTS (SELECT 1 FROM seat_pots sp WHERE sp.pot_id = pots.pot_id)),
          j AS (SELECT pot_id, max((args->>'depYes')::numeric) AS dy, max((args->>'depNo')::numeric) AS dn FROM pot_events
                 WHERE event_name = 'Joined' AND pot_id IN (SELECT pot_id FROM p) GROUP BY pot_id),
          paid AS (SELECT pot_id, sum(coalesce((args->>'paidYes')::numeric, 0)) AS py, sum(coalesce((args->>'paidNo')::numeric, 0)) AS pn FROM pot_events
                 WHERE event_name IN ('PotDivided', 'PotSettled', 'PotExpired') AND pot_id IN (SELECT pot_id FROM p) GROUP BY pot_id)
     SELECT p.pot_id::text AS pot_id, p.yes, p.no, (paid.py - j.dy)::text AS yes_net, (paid.pn - j.dn)::text AS no_net
       FROM p JOIN j USING (pot_id) JOIN paid USING (pot_id) ORDER BY p.pot_id DESC LIMIT 200`,
    [x, y],
  );
  let aAhead = 0;
  let bAhead = 0;
  let even = 0;
  const pots = rows.map((r) => {
    const aNet = r.yes === x ? r.yes_net : r.no_net;
    const bNet = r.yes === x ? r.no_net : r.yes_net;
    const d = Number(aNet) - Number(bNet);
    // within a cent counts as even (fees and rounding)
    if (Math.abs(d) < 10_000) even++;
    else if (d > 0) aAhead++;
    else bAhead++;
    return { potId: r.pot_id, aNet, bNet };
  });
  return { a: x, b: y, played: rows.length, aAhead, bAhead, even, pots };
}

/* ------------------------------------------------------------------ reactions (cat gestures at the rope) */

export const REACTIONS = ["paw up", "purr", "hiss"] as const;

/**
 * Records one gesture. `who` is an opaque daily hash of the sender; one gesture per sender per pot
 * every 3 seconds. Returns false when it came too soon.
 */
export async function react(db: Db, potId: string, kind: number, who: string) {
  if (!Number.isInteger(kind) || kind < 0 || kind >= REACTIONS.length) throw Object.assign(new Error("unknown reaction"), { status: 400 });
  const recent = await db.query("SELECT 1 FROM pot_reactions WHERE pot_id = $1 AND who = $2 AND at > now() - interval '3 seconds'", [potId, who]);
  if (recent.length) return false;
  await db.query("INSERT INTO pot_reactions (pot_id, kind, who) VALUES ($1, $2, $3)", [potId, kind, who]);
  if (Math.random() < 0.02) await db.query("DELETE FROM pot_reactions WHERE at < now() - interval '1 day'");
  return true;
}

/** Gestures of the last 20 seconds for a pot (or -perpId): each with its kind and age in ms. */
export async function recentReactions(db: Db, potId: string) {
  const rows = await db.query<{ id: string; kind: number; age_ms: string }>(
    "SELECT id::text AS id, kind, (extract(epoch FROM now() - at) * 1000)::bigint::text AS age_ms FROM pot_reactions WHERE pot_id = $1 AND at > now() - interval '20 seconds' ORDER BY at DESC LIMIT 40",
    [potId],
  );
  return rows.map((r) => ({ id: r.id, kind: Number(r.kind), ageMs: Number(r.age_ms) }));
}
