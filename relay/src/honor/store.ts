import type { Db } from "../db";
import { getConfig } from "../config";
import { relaySender } from "../chain";
import { computeHonor, type Cluster, type HonorEvent, type HonorInput } from "./compute";
import { CURRENT_HONOR, HONOR_CONFIGS, honorCosmetics, titleOf } from "./config";

/**
 * Honor in the database: the inputs read from the indexer's tables, the full recomputation (every
 * hour, behind HONOR=on), the stored history and balances, and the daily farming check.
 * Tables: honor_entries, honor_balances, honor_flags, account_funding (db.ts).
 */

export const honorOn = () => (process.env.HONOR ?? "").toLowerCase() === "on";

/** Everything the computation reads, from the database: deterministic for the same tables. */
export async function loadHonorInput(db: Db): Promise<HonorInput> {
  const ev = await db.query<{ block_number: string; log_index: number; block_time: string | null; event_name: string; pot_id: string | null; args: Record<string, unknown> }>(
    `SELECT block_number::text AS block_number, log_index, block_time::text AS block_time, event_name, pot_id::text AS pot_id, args FROM pot_events
      WHERE block_time IS NOT NULL AND event_name IN ('PotCreated','Transfer','Joined','Handshake','TakenOver','PotDivided','ExitRequested','PotSettled','PotExpired','ReferrerSet',
        'Perp:PerpOpened','Perp:PerpJoined','Perp:RopeStarted','Perp:LeaveRequested','Perp:PerpEnded')
      ORDER BY block_number, log_index`,
  );
  const events: HonorEvent[] = ev.map((e) => ({ block: Number(e.block_number), log: e.log_index, at: Number(e.block_time), name: e.event_name, potId: e.pot_id, args: e.args }));
  const notes = (
    await db.query<{ pot_id: string; account: string; at: string }>(
      "SELECT pot_id::text AS pot_id, account, extract(epoch FROM created_at)::bigint::text AS at FROM pot_notes WHERE kind = 'well_played' ORDER BY created_at, account",
    )
  ).map((n) => ({ potId: n.pot_id, account: n.account.toLowerCase(), at: Number(n.at) }));
  await (await import("../practice")).markPracticePots(db).catch((e) => console.error("[honor] practice", (e as Error).message));
  const practice = new Set((await db.query<{ id: string }>("SELECT pot_id::text AS id FROM practice_pots")).map((r) => r.id));
  const seats = new Set((await db.query<{ id: string }>("SELECT pot_id::text AS id FROM seat_pots")).map((r) => r.id));
  const funding = Object.fromEntries(
    (await db.query<{ account: string; funder: string }>("SELECT account, funder FROM account_funding WHERE funder IS NOT NULL")).map((r) => [r.account, r.funder]),
  );
  const clusters: Cluster[] = (await db.query<{ accounts: string[]; reason: string; since: string }>("SELECT accounts, reason, since::text AS since FROM honor_flags ORDER BY id")).map((c) => ({
    accounts: c.accounts,
    reason: c.reason,
    since: Number(c.since),
  }));
  const cfg = getConfig();
  // HonorCat's own wallets fund many unrelated players (welcome money, the practice cat): never a link.
  const shared = new Set([relaySender(), ...(process.env.HONOR_SHARED_FUNDERS ?? "").split(",")].map((x) => x.trim().toLowerCase()).filter(Boolean));
  // Not players: the perps contract, the practice cat (practice play earns nothing) and HonorCat's own
  // test accounts (house_accounts, written by the test scripts).
  const house = (await db.query<{ account: string }>("SELECT account FROM house_accounts").catch(() => [])).map((r) => r.account);
  const notPlayers = new Set([cfg.ropes?.perps, relaySender(), ...house].filter(Boolean).map((x) => String(x).toLowerCase()));
  const cutoff = events.length ? events.at(-1)!.at : 0;
  return { events, notes, practice, seats, funding, sharedFunders: shared, clusters, notPlayers, cutoff };
}

/** Recomputes honor from scratch and replaces the stored history and balances of the current version. */
export async function recomputeHonor(db: Db) {
  const input = await loadHonorInput(db);
  const cfg = CURRENT_HONOR;
  const r = computeHonor(input, cfg);
  await db.query("DELETE FROM honor_entries WHERE version = $1", [cfg.version]);
  for (let i = 0; i < r.entries.length; i += 200) {
    const chunk = r.entries.slice(i, i + 200);
    const vals: string[] = [];
    const params: unknown[] = [];
    for (const e of chunk) {
      const o = params.length;
      vals.push(`($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11})`);
      params.push(cfg.version, e.seq, e.account, e.at, e.action, e.potId, e.counterparty, e.base, e.points, JSON.stringify(e.notes), e.removed);
    }
    await db.query(`INSERT INTO honor_entries (version, seq, account, at, action, pot_id, counterparty, base, points, notes, removed) VALUES ${vals.join(",")}`, params);
  }
  await db.query("DELETE FROM honor_balances WHERE version = $1", [cfg.version]);
  const bal = Object.entries(r.balances);
  for (let i = 0; i < bal.length; i += 300) {
    const chunk = bal.slice(i, i + 300);
    await db.query(
      `INSERT INTO honor_balances (version, account, points) VALUES ${chunk.map((_, j) => `($1, $${2 * j + 2}, $${2 * j + 3})`).join(",")}`,
      [cfg.version, ...chunk.flatMap(([a, p]) => [a, p])],
    );
  }
  const lastBlock = input.events.length ? input.events.at(-1)!.block : 0;
  await db.query(
    "INSERT INTO relay_state (key, value) VALUES ('honor_state', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [JSON.stringify({ version: cfg.version, lastBlock, cutoff: input.cutoff, computedAt: Math.floor(Date.now() / 1000), entries: r.entries.length, players: bal.length })],
  );
  return { version: cfg.version, entries: r.entries.length, players: bal.length, lastBlock };
}

export async function honorState(db: Db) {
  const v = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'honor_state'"))[0]?.value;
  return v ? (JSON.parse(v) as { version: number; lastBlock: number; cutoff: number; computedAt: number; entries: number; players: number }) : null;
}

/** A player's honor: points, title, cosmetics (current and next), and their history, newest first. */
export async function honorOf(db: Db, account: string, opts: { history?: boolean; limit?: number } = {}) {
  const a = account.toLowerCase();
  const v = CURRENT_HONOR.version;
  const points = Number((await db.query<{ points: number }>("SELECT points FROM honor_balances WHERE version = $1 AND account = $2", [v, a]))[0]?.points ?? 0) / 100;
  const history = opts.history
    ? (
        await db.query<{ seq: number; at: string; action: string; pot_id: string | null; counterparty: string | null; base: number; points: number; notes: string[] | string; removed: string | null }>(
          "SELECT seq, at::text AS at, action, pot_id, counterparty, base, points, notes, removed FROM honor_entries WHERE version = $1 AND account = $2 ORDER BY seq DESC LIMIT $3",
          [v, a, Math.min(300, opts.limit ?? 300)],
        )
      ).map((e) => ({ ...e, at: Number(e.at), base: e.base / 100, points: e.points / 100, notes: typeof e.notes === "string" ? (JSON.parse(e.notes) as string[]) : e.notes }))
    : undefined;
  return { account: a, version: v, points, title: titleOf(points), cosmetics: honorCosmetics(points), history };
}

/** Points and titles for many accounts (lists, pots, member lists). */
export async function honorMany(db: Db, accounts: string[]) {
  const list = [...new Set(accounts.map((x) => x.toLowerCase()))].slice(0, 200);
  const rows = list.length
    ? await db.query<{ account: string; points: number }>("SELECT account, points FROM honor_balances WHERE version = $1 AND account = ANY($2::text[])", [CURRENT_HONOR.version, list])
    : [];
  const by = new Map(rows.map((r) => [r.account, r.points / 100]));
  return Object.fromEntries(list.map((a) => [a, { points: by.get(a) ?? 0, title: titleOf(by.get(a) ?? 0) }]));
}

/**
 * The honor table: all time (or since `days`), everyone, friends (players met in a pot) or the
 * players someone follows. Ranked by honor earned in the period.
 */
export async function honorBoard(db: Db, opts: { days?: number; only?: string[] | null; limit?: number } = {}) {
  const since = opts.days && opts.days > 0 ? Math.floor(Date.now() / 1000) - opts.days * 86_400 : 0;
  const rows = await db.query<{ account: string; points: string; total: number }>(
    `SELECT e.account, sum(e.points)::text AS points, coalesce(b.points, 0) AS total FROM honor_entries e
       LEFT JOIN honor_balances b ON b.version = e.version AND b.account = e.account
      WHERE e.version = $1 AND e.at >= $2 AND e.removed IS NULL AND ($3::text[] IS NULL OR e.account = ANY($3::text[]))
      GROUP BY e.account, b.points HAVING sum(e.points) > 0 ORDER BY sum(e.points) DESC LIMIT $4`,
    [CURRENT_HONOR.version, since, opts.only ?? null, opts.limit ?? 50],
  );
  return rows.map((r) => ({ account: r.account, points: Number(r.points) / 100, total: Number(r.total) / 100, title: titleOf(Number(r.total) / 100) }));
}

export const honorConfigOf = (version: number) => HONOR_CONFIGS[version] ?? null;

/* ------------------------------------------------------------------ the daily farming check */

/**
 * Looks up who first funded each player that earned honor (Arc's explorer: the oldest token
 * transfer to the account), at most `max` new accounts per run.
 */
export async function lookUpFunding(db: Db, max = 30) {
  const todo = await db.query<{ account: string }>(
    `SELECT DISTINCT account FROM honor_entries WHERE version = $1 AND account NOT IN (SELECT account FROM account_funding) LIMIT $2`,
    [CURRENT_HONOR.version, max],
  );
  const base = process.env.ARC_EXPLORER_API ?? "https://explorer.testnet.arc.io/api/v2";
  let found = 0;
  for (const { account } of todo) {
    let funder: string | null = null;
    let tx: string | null = null;
    let url: string | null = `${base}/addresses/${account}/token-transfers?type=ERC-20&filter=to`;
    for (let page = 0; url && page < 5; page++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
      if (!r?.ok) break;
      const j = (await r.json()) as { items: { from: { hash: string }; transaction_hash?: string; tx_hash?: string }[]; next_page_params: Record<string, string> | null };
      const last = j.items.at(-1);
      if (last) {
        funder = last.from.hash.toLowerCase();
        tx = last.transaction_hash ?? last.tx_hash ?? null;
      }
      url = j.next_page_params ? `${base}/addresses/${account}/token-transfers?type=ERC-20&filter=to&${new URLSearchParams(j.next_page_params).toString()}` : null;
    }
    await db.query("INSERT INTO account_funding (account, funder, tx) VALUES ($1, $2, $3) ON CONFLICT (account) DO UPDATE SET funder = EXCLUDED.funder, tx = EXCLUDED.tx, checked_at = now()", [
      account,
      funder,
      tx,
    ]);
    if (funder) found++;
  }
  return { looked: todo.length, found };
}

/**
 * Flags pairs that farm each other: at least 5 pots with each other within 7 days, most of them
 * joined within a minute of opening and ended within an hour. Their honor with each other is removed
 * from the first such pot on, with the reason (the history shows it).
 */
export async function farmingCheck(db: Db) {
  const rows = await db.query<{ a: string; b: string; n: string; quick: string; first: string }>(
    `WITH p AS (
       SELECT c.pot_id, lower(c.args->>'creator') AS a, c.block_time AS opened,
              (SELECT min(j.block_time) FROM pot_events j WHERE j.pot_id = c.pot_id AND j.event_name = 'Joined') AS joined,
              (SELECT min(x.block_time) FROM pot_events x WHERE x.pot_id = c.pot_id AND x.event_name IN ('PotSettled','PotExpired','PotDivided')) AS ended,
              (SELECT lower(t.args->>'to') FROM pot_events t WHERE t.pot_id = c.pot_id AND t.event_name = 'Transfer' AND t.args->>'from' ~* '^0x0{40}$'
                AND lower(t.args->>'to') <> lower(c.args->>'creator') LIMIT 1) AS b
         FROM pot_events c WHERE c.event_name = 'PotCreated' AND c.block_time > extract(epoch FROM now())::bigint - 7 * 86400
     )
     SELECT least(a, b) AS a, greatest(a, b) AS b, count(*)::text AS n,
            count(*) FILTER (WHERE joined - opened < 60 AND ended - joined < 3600)::text AS quick, min(opened)::text AS first
       FROM p WHERE b IS NOT NULL AND a <> b GROUP BY 1, 2 HAVING count(*) >= 5`,
  );
  let flagged = 0;
  for (const r of rows) {
    if (Number(r.quick) * 10 < Number(r.n) * 7) continue; // under 70% quick: not this pattern
    const reason = "flagged by the daily check: many quick pots with the same player";
    const exists = await db.query("SELECT 1 FROM honor_flags WHERE accounts @> $1::text[] AND accounts <@ $1::text[] AND reason = $2", [[r.a, r.b], reason]);
    if (exists.length) continue;
    await db.query("INSERT INTO honor_flags (accounts, reason, since) VALUES ($1, $2, $3)", [[r.a, r.b], reason, Number(r.first)]);
    flagged++;
  }
  return { pairs: rows.length, flagged };
}

/** Hourly: recompute (and once a day the farming check first). Behind HONOR=on. */
export async function honorHousekeeping(db: Db) {
  if (!honorOn()) return { skipped: true };
  const st = await honorState(db);
  const now = Math.floor(Date.now() / 1000);
  if (st && now - st.computedAt < 3600) return { skipped: true };
  const lastCheck = Number((await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'honor_check_at'"))[0]?.value ?? 0);
  const first = await recomputeHonor(db);
  if (now - lastCheck > 86_400) {
    // the funding lookup needs the players who earned honor; then the check, then count again
    const f = await lookUpFunding(db).catch((e) => (console.error("[honor] funding", (e as Error).message), { found: 0 }));
    const c = await farmingCheck(db).catch((e) => (console.error("[honor] check", (e as Error).message), { flagged: 0 }));
    await db.query("INSERT INTO relay_state (key, value) VALUES ('honor_check_at', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [String(now)]);
    const again = f.found || c.flagged ? await recomputeHonor(db) : first;
    // the day's root (tree kept for proofs; posted to HonorRoots once it is deployed)
    await (await import("./roots")).postDailyRoot(db).catch((e) => console.error("[honor] root", (e as Error).message));
    return again;
  }
  return first;
}
