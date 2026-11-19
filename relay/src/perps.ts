/**
 * Perps (HonorCatPerps) in the relay: the read model, indexing, and the automatic steps nobody has to
 * wait for. The relay has no discretion and holds no funds: every call below anyone could make with
 * the same public data and the samplers' signatures, and the contracts check everything.
 *
 * Automatic steps (perpsHousekeeping, every tick):
 * - a perp with both players in and no rope: start the first rope around the live price (the pot
 *   contract prices it with the join window after the request);
 * - a first rope whose join was priced, or not: `advance` (Running, or both stakes back);
 * - a rope that ended (knock-out, expiry, exit, handshake, settlement): `advance` credits both payouts
 *   and, after a knock-out or an expiry, opens the next rope at the division price in the same
 *   transaction, or ends the chain when a rule says so.
 * Rolls need a fresh depth attestation for the perp contract (the cap); the app's sampler signs it at
 * once and the others co-sign within seconds, so a roll lands one or two ticks after the division.
 */
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex, type LocalAccount } from "viem";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { rowBySymbol, bookStats } from "./catalog";
import { readBook } from "./gemini";
import { memoCall } from "./memo";
import { perpsAbi } from "./perpsAbi";
import { depthResult, marketOf, recordPotEvent, requestDepthV2, syncPot, type DepthAtt } from "./pots";
import { ropeDbId } from "./ropes";
import { notifyPot, perpMessage } from "./push";
import { sendRelayCalls } from "./txs";

export const PERP_PHASES = ["None", "Open", "Funded", "Joining", "Running", "Ended"] as const;
const POT_STATES = ["None", "Open", "Joining", "Live", "ExitRequested", "Divided", "Settled", "Expired"] as const;
const CRYPTO_SYMBOL = /^GEMI-(BTC|ETH|SOL|XRP|DOGE|HYPE|ZEC|LTC|AVAX|LINK|ADA|BNB|SUI)/i;

export function perpsAddress(): Address | null {
  return getConfig().ropes?.perps ?? null;
}

const jsonify = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonify) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonify(x)])) : v;

/** Reads a perp from the chain into `perps` (with its current rope's database id and lives). */
export async function syncPerp(db: Db, perpId: bigint) {
  const address = perpsAddress();
  if (!address) return null;
  const c = publicClient();
  const q = (await c.readContract({ address, abi: perpsAbi, functionName: "perp", args: [perpId] })) as unknown as Record<string, unknown> & { t: Record<string, unknown>; pot: bigint; phase: number; a: string; b: string };
  if (Number(q.phase) === 0) return null;
  const [livesA, livesB] = (await c.readContract({ address, abi: perpsAbi, functionName: "lives", args: [perpId] })) as readonly [bigint, bigint];
  const stake = (await c.readContract({ address, abi: perpsAbi, functionName: "stake", args: [perpId] })) as bigint;
  const potDb = q.pot > 0n ? ropeDbId(q.pot) : null;
  const data = { ...(jsonify(q) as Record<string, unknown>), livesA: livesA.toString(), livesB: livesB.toString(), stake: stake.toString(), potDb };
  const before = (await db.query<{ data: Record<string, unknown> | string }>("SELECT data FROM perps WHERE perp_id = $1", [perpId.toString()]))[0];
  const prev = before ? (typeof before.data === "string" ? JSON.parse(before.data) : before.data) : null;
  await db.query(
    `INSERT INTO perps (perp_id, phase, a, b, pot_id, data) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (perp_id) DO UPDATE SET phase = EXCLUDED.phase, a = EXCLUDED.a, b = EXCLUDED.b, pot_id = EXCLUDED.pot_id, data = EXCLUDED.data, updated_at = now()`,
    [perpId.toString(), Number(q.phase), String(q.a).toLowerCase(), /^0x0+$/.test(String(q.b)) ? null : String(q.b).toLowerCase(), potDb, JSON.stringify(data)],
  );
  if (potDb) await syncPot(db, BigInt(potDb)).catch(() => {});
  const msg = perpMessage(perpId.toString(), prev, data);
  if (msg) await notifyPot(db, `-${perpId}`, msg.title, msg.body, `-${perpId}:${Number(q.phase)}:${String(q.ropes)}:${livesA}:${livesB}:${msg.title}`).catch((e) => console.error("[push]", e));
  return data;
}

/** Reads new HonorCatPerps logs (own cursor) and refreshes every perp they touch. */
export async function indexPerps(db: Db, head: bigint, opts: { deadlineMs?: number } = {}) {
  const address = perpsAddress();
  const r = getConfig().ropes;
  if (!address || !r) return null;
  const c = publicClient();
  const started = Date.now();
  const cursor = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'perps_cursor'");
  let from = cursor[0] ? BigInt(cursor[0].value) + 1n : r.deployBlock;
  const touched = new Set<string>();
  while (from <= head && Date.now() - started < (opts.deadlineMs ?? 10_000)) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await c.getLogs({ address, fromBlock: from, toBlock: to });
    for (const l of parseEventLogs({ abi: perpsAbi, logs })) {
      const a = l.args as { perpId?: bigint; potId?: bigint };
      if (typeof a.perpId === "bigint") touched.add(a.perpId.toString());
      const t = Number((await c.getBlock({ blockNumber: l.blockNumber })).timestamp);
      await recordPotEvent(db, { ...l, eventName: `Perp:${l.eventName}` }, typeof a.potId === "bigint" ? BigInt(ropeDbId(a.potId)) : null, t, "rpc");
    }
    await db.query("INSERT INTO relay_state (key, value) VALUES ('perps_cursor', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [to.toString()]);
    from = to + 1n;
  }
  for (const id of touched) await syncPerp(db, BigInt(id)).catch((e) => console.error("[perps] sync", id, e));
  return { touched: touched.size };
}

type PerpRow = { perp_id: string; phase: number; pot_id: string | null; data: Record<string, unknown> | string };
const dataOf = (r: PerpRow) => (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown> & { t: Record<string, string> };

/** A fresh, co-signed depth attestation for the perp contract on this perp's market (asks for one if needed). */
async function perpDepth(db: Db, perpId: string, t: Record<string, string>, own: LocalAccount | null): Promise<{ depth: DepthAtt; sigs: Hex } | null> {
  const key = `perp_depth:${perpId}`;
  const now = Math.floor(Date.now() / 1000);
  const prev = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [key]))[0];
  if (prev) {
    const { id, at } = JSON.parse(prev.value) as { id: string; at: number };
    const r = await depthResult(db, id);
    if (r?.signatures && Number(r.depth.validUntil) > now + 15) return { depth: r.depth, sigs: r.signatures };
    if (now - at < 20) return null; // the others are still co-signing
  }
  const m = await marketOf(db, String(t.conditionId));
  if (!m) return null;
  const row = await rowBySymbol(db, m.instrument).catch(() => null);
  const crypto = row ? row.category === "Crypto" : CRYPTO_SYMBOL.test(m.instrument);
  const { id } = await requestDepthV2(db, { conditionId: String(t.conditionId) as Hex, account: perpsAddress()!, instrument: m.instrument, closeTime: Number(t.closeTime), crypto }, own);
  await db.query("INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [key, JSON.stringify({ id, at: now })]);
  return null;
}

const depthArg = (d: DepthAtt) => ({
  conditionId: d.conditionId,
  account: getAddress(d.account),
  contracts5c: BigInt(d.contracts5c),
  spread: d.spread ?? 0,
  crypto: d.crypto ?? false,
  closeTime: BigInt(d.closeTime),
  validUntil: BigInt(d.validUntil),
});
const NO_DEPTH = { conditionId: `0x${"0".repeat(64)}` as Hex, account: "0x0000000000000000000000000000000000000000" as Address, contracts5c: 0n, spread: 0, crypto: false, closeTime: 0n, validUntil: 0n };

/** One pass over running perps: start first ropes, credit priced joins and ended ropes, roll or end. */
export async function perpsHousekeeping(db: Db, own: LocalAccount | null) {
  const address = perpsAddress();
  if (!address) return { checked: 0, calls: 0 };
  const rows = await db.query<PerpRow>("SELECT perp_id::text AS perp_id, phase, pot_id, data FROM perps WHERE phase BETWEEN 2 AND 4");
  let calls = 0;
  for (const row of rows) {
    // One perp's trouble (a closed market, an unreadable book) must not stop the others.
    try {
      calls += await advanceOne(db, address, row, own);
    } catch (e) {
      console.error("[perps] housekeeping", row.perp_id, (e as Error).message.slice(0, 200));
    }
  }
  return { checked: rows.length, calls };
}

/**
 * Whether the chain will roll on to a new rope when this ended rope is credited (the contract's own
 * test): only after a knock-out or an expiry, nobody leaving, both renewing, both with a stake left.
 * A rope that settled or was given back never rolls, so it needs no depth attestation.
 */
export function perpWillRoll(potState: string, q: Record<string, unknown>) {
  if (potState !== "Divided") return false;
  return !q.leaving && q.renewA !== false && q.renewB !== false;
}

async function advanceOne(db: Db, address: Address, row: PerpRow, own: LocalAccount | null): Promise<number> {
  let calls = 0;
  {
    const q = dataOf(row);
    const id = BigInt(row.perp_id);
    let data: Hex | null = null;
    let why = "";
    if (row.phase === 2) {
      // Both players in, no rope: start the first rope around the live price.
      const m = await marketOf(db, String(q.t.conditionId));
      const raw = m ? await readBook(m.instrument) : null;
      const st = raw ? bookStats(raw, Date.now()) : null;
      if (!st || st.bid === null || st.ask === null) return 0;
      const center = Math.round(((st.bid + st.ask) / 2) * 10_000) * 100;
      const dep = await perpDepth(db, row.perp_id, q.t, own);
      if (!dep) return 0;
      data = encodeFunctionData({ abi: perpsAbi, functionName: "startFirstRope", args: [id, center, depthArg(dep.depth), dep.sigs] });
      why = `first rope around ${(center / 10_000).toFixed(2)}%`;
    } else if (row.pot_id) {
      const pot = (await db.query<{ state: number; expiry: string | null }>("SELECT state, data->>'expiry' AS expiry FROM pots WHERE pot_id = $1", [row.pot_id]))[0];
      if (!pot) {
        await syncPot(db, BigInt(row.pot_id)).catch(() => {});
        return 0;
      }
      const s = POT_STATES[pot.state];
      const joinDone = row.phase === 3 && (s === "Live" || s === "Open");
      const ropeDone = row.phase === 4 && (s === "Divided" || s === "Settled" || s === "Expired");
      if (!joinDone && !ropeDone) {
        // A rope about to end (an exit or knock-out being priced, or its expiry under a minute away):
        // ask for the next rope's depth attestation now, so the roll goes out with the division.
        // Only while the chain would roll, and not for ropes long past their end (waiting for the
        // market's result): those would ask for a new attestation every two minutes for days.
        const nowS = Math.floor(Date.now() / 1000);
        const expiry = Number(pot.expiry ?? 0);
        const nearEnd = expiry > 0 && expiry - nowS < 60 && nowS - expiry < 300;
        const exitPriced = s === "ExitRequested" && !q.leaving;
        if (row.phase === 4 && (exitPriced || nearEnd) && perpWillRoll("Divided", q)) await perpDepth(db, row.perp_id, q.t, own).catch(() => null);
        return 0;
      }
      let depth = NO_DEPTH;
      let sigs: Hex = "0x";
      if (ropeDone && perpWillRoll(s, q)) {
        const dep = await perpDepth(db, row.perp_id, q.t, own);
        if (!dep) return 0; // a fresh depth attestation comes within seconds; the roll waits for it
        depth = depthArg(dep.depth);
        sigs = dep.sigs;
      }
      data = encodeFunctionData({ abi: perpsAbi, functionName: "advance", args: [id, depth, sigs] });
      why = joinDone ? "first rope priced" : `rope ${s.toLowerCase()}: credit, then roll or end`;
    }
    if (!data) return 0;
    const ref = `perp-${row.perp_id}`;
    const res = await sendRelayCalls(db, "pot_house", [{ ...memoCall(address, data, ref, { v: 1, t: "pot", ref, why }), potIds: [], label: `perp ${row.perp_id}: ${why}` }]);
    calls++;
    if (res.ok) {
      await db.query("DELETE FROM relay_state WHERE key = $1", [`perp_depth:${row.perp_id}`]);
      await syncPerp(db, id).catch(() => {});
    }
  }
  return calls;
}

/** Perps for the pages: one with its ropes so far, or a list. */
export async function perpDetail(db: Db, perpId: string) {
  const row = (await db.query<PerpRow & { a: string; b: string | null }>("SELECT perp_id::text AS perp_id, phase, pot_id, data, a, b FROM perps WHERE perp_id = $1", [perpId]))[0];
  if (!row) return null;
  const ropes = await db.query<{ args: Record<string, string>; tx_hash: string; block_time: string | null; event_name: string; pot_id: string | null }>(
    "SELECT args, tx_hash, block_time::text AS block_time, event_name, pot_id::text AS pot_id FROM pot_events WHERE event_name LIKE 'Perp:%' AND args->>'perpId' = $1 ORDER BY block_number, log_index",
    [perpId],
  );
  const practice = (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [`-${row.perp_id}`])).length > 0;
  const market = await perpMarket(db, row);
  // Gemini's page slug for the "trade this market" link (the event ticker alone also works).
  const slug = market ? ((await rowBySymbol(db, market.instrument).catch(() => null)) as { slug?: string | null } | null)?.slug ?? null : null;
  return { perpId: row.perp_id, phase: PERP_PHASES[row.phase], a: row.a, b: row.b, pot: row.pot_id, data: dataOf(row), practice, market: market && { ...market, slug }, events: ropes.map((e) => ({ name: e.event_name.slice(5), args: e.args, tx: e.tx_hash, at: e.block_time ? Number(e.block_time) : null, pot: e.pot_id })) };
}

export async function listPerps(db: Db, opts: { owner?: string; phases?: number[]; limit?: number } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.owner) {
    args.push(opts.owner.toLowerCase());
    where.push(`(a = $${args.length} OR b = $${args.length})`);
  }
  if (opts.phases?.length) {
    args.push(opts.phases);
    where.push(`phase = ANY($${args.length}::smallint[])`);
  }
  args.push(opts.limit ?? 50);
  const rows = await db.query<PerpRow & { a: string; b: string | null }>(
    `SELECT perp_id::text AS perp_id, phase, pot_id, data, a, b FROM perps ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY perp_id DESC LIMIT $${args.length}`,
    args,
  );
  return Promise.all(rows.map(async (r) => ({ perpId: r.perp_id, phase: PERP_PHASES[r.phase], a: r.a, b: r.b, pot: r.pot_id, data: dataOf(r), market: await perpMarket(db, r) })));
}

/**
 * The perp's market (by its conditionId), without the trigger parameters, and the YES price its
 * leverages are shown at (ppm): the running rope's entry, else the market's last price in the
 * catalogue (an open offer starts its first rope at the price when both are in).
 */
async function perpMarket(db: Db, r: PerpRow) {
  const q = dataOf(r);
  const m = await marketOf(db, String(q.t.conditionId)).catch(() => null);
  if (!m) return null;
  let center: number | null = null;
  if (r.pot_id) {
    const p = (await db.query<{ lower: string | null }>("SELECT data->>'lower' AS lower FROM pots WHERE pot_id = $1", [r.pot_id]))[0];
    if (p?.lower) center = Number(p.lower) + Number(q.t.d);
  }
  if (center === null) {
    const c = await rowBySymbol(db, m.instrument).catch(() => null);
    const bid = c?.book?.bid ?? c?.bid ?? null;
    const ask = c?.book?.ask ?? c?.ask ?? null;
    if (bid !== null && ask !== null) center = Math.round(((bid + ask) / 2) * 1e6);
  }
  return { instrument: m.instrument, eventTicker: m.eventTicker, contractTicker: m.contractTicker, eventTitle: m.eventTitle, label: m.label, center };
}

/** One rope of a perp, for the perp page's chart and its "how it ended" lines. */
export type RopeStory = {
  rope: number;
  pot: string;
  lower: number;
  upper: number;
  /** When the rope started running and when it had to end at the latest (unix seconds; 0 when unknown). */
  armedAt: number;
  expiry: number;
  /** The price window that ended the rope (or priced its start), with each sampler's own average. */
  decided: {
    kind: "entry" | "exit" | "post" | "expiry";
    windowStart: number;
    windowEnd: number;
    priceYes: number | null;
    averages: { signer: string; priceYes: number; valid: boolean; samples: number }[];
    tx: string | null;
  } | null;
  /** Price windows asked for and not agreed (missing or invalid sampler readings). */
  unagreed: number;
  /** Every 30-second price the samplers measured for this rope: [window end (s), YES price (ppm)]. */
  checks: [number, number][];
};

const STORY_KIND: Record<number, NonNullable<RopeStory["decided"]>["kind"]> = { 0: "entry", 1: "exit", 7: "post", 8: "expiry" };

/**
 * Each rope of a perp with its posts and the price window that decided it: when it was measured and
 * what each sampler's own average was. Public data only (the same as the evidence pages).
 */
export async function perpRopes(db: Db, perpId: string): Promise<RopeStory[]> {
  const started = await db.query<{ rope: string; pot_id: string }>(
    "SELECT args->>'rope' AS rope, pot_id::text AS pot_id FROM pot_events WHERE event_name = 'Perp:RopeStarted' AND args->>'perpId' = $1 AND pot_id IS NOT NULL ORDER BY block_number, log_index",
    [perpId],
  );
  if (!started.length) return [];
  const pots = started.map((r) => r.pot_id);
  const potRows = await db.query<{ pot_id: string; lower: string | null; upper: string | null; armed: string | null; expiry: string | null }>(
    "SELECT pot_id::text AS pot_id, data->>'lower' AS lower, data->>'upper' AS upper, data->>'armedAt' AS armed, data->>'expiry' AS expiry FROM pots WHERE pot_id = ANY($1::bigint[])",
    [pots],
  );
  const reqs = await db.query<{ id: string; pot_id: string; status: string; tx: string | null; kind: string | null; ws: string | null; we: string | null; memo: string | null }>(
    `SELECT id, pot_id::text AS pot_id, status, tx, payload->>'kind' AS kind, payload->>'windowStart' AS ws, payload->>'windowEnd' AS we, payload->>'memo' AS memo
       FROM att_requests WHERE kind = 'window' AND pot_id = ANY($1::bigint[]) ORDER BY created_at`,
    [pots],
  );
  const ids = reqs.map((r) => r.id);
  const avgs = ids.length
    ? await db.query<{ request_id: string; signer: string; price_ppm: string; valid: boolean; sample_count: number }>(
        "SELECT request_id, signer, price_ppm::text AS price_ppm, valid, sample_count FROM att_averages WHERE request_id = ANY($1::text[]) ORDER BY signer",
        [ids],
      )
    : [];
  return started.map((s) => {
    const p = potRows.find((r) => r.pot_id === s.pot_id);
    const mine = reqs.filter((r) => r.pot_id === s.pot_id && r.kind !== null && STORY_KIND[Number(r.kind)] !== undefined);
    // The deciding window: the last one sent on-chain with a price (not "no … price").
    const decidedReq = [...mine].reverse().find((r) => r.status === "submitted" && Number(r.kind) !== 0 && !/^no /.test(r.memo ?? ""))
      ?? [...mine].reverse().find((r) => r.status === "submitted" && Number(r.kind) === 0 && !/^no /.test(r.memo ?? ""));
    const price = decidedReq?.memo?.match(/(\d+(?:\.\d+)?)% \(YES\)/);
    const own = decidedReq ? avgs.filter((a) => a.request_id === decidedReq.id) : [];
    return {
      rope: Number(s.rope),
      pot: s.pot_id,
      lower: Number(p?.lower ?? 0),
      upper: Number(p?.upper ?? 0),
      armedAt: Number(p?.armed ?? 0),
      expiry: Number(p?.expiry ?? 0),
      decided: decidedReq
        ? {
            kind: STORY_KIND[Number(decidedReq.kind)]!,
            windowStart: Number(decidedReq.ws ?? 0),
            windowEnd: Number(decidedReq.we ?? 0),
            priceYes: price ? Math.round(Number(price[1]) * 10_000) : null,
            averages: own.map((a) => ({ signer: a.signer, priceYes: Number(a.price_ppm), valid: a.valid, samples: a.sample_count })),
            tx: decidedReq.tx,
          }
        : null,
      unagreed: mine.filter((r) => r.status === "failed").length,
      checks: mine
        .map((r): [number, number] | null => {
          // the reading with the most samples stands for the window (valid ones agree within half a point)
          const best = avgs.filter((a) => a.request_id === r.id && a.sample_count > 0).sort((x, y) => y.sample_count - x.sample_count)[0];
          return best && r.we ? [Number(r.we), Number(best.price_ppm)] : null;
        })
        .filter((c): c is [number, number] => c !== null),
    };
  });
}

/** Perp logs delivered by QuickNode Streams: recorded at once (source "streams"), then the perps re-read. */
export async function ingestPerpLogs(db: Db, logs: { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number }[], blockTime: (n: bigint) => Promise<number | null>) {
  const address = perpsAddress();
  if (!address) return { received: 0 };
  const ours = logs.filter((l) => l.address.toLowerCase() === address.toLowerCase());
  const dec = parseEventLogs({ abi: perpsAbi, logs: ours.map((l) => ({ ...l, blockHash: null, transactionIndex: null, removed: false })) as never });
  const touched = new Set<string>();
  for (const l of dec) {
    const a = l.args as { perpId?: bigint; potId?: bigint };
    if (typeof a.perpId === "bigint") touched.add(a.perpId.toString());
    await recordPotEvent(db, { ...l, eventName: `Perp:${l.eventName}` } as never, typeof a.potId === "bigint" ? BigInt(ropeDbId(a.potId)) : null, await blockTime(l.blockNumber!).catch(() => null), "streams");
  }
  for (const id of touched) await syncPerp(db, BigInt(id)).catch((e) => console.error("[perps] sync", id, e));
  return { received: dec.length };
}
