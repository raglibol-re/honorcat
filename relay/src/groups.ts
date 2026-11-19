/**
 * Group pots (HonorCatGroups) in the relay: the read model, indexing, and the automatic steps.
 * The relay has no discretion and holds no funds: every call below anyone could make with the same
 * public data and the samplers' signatures, and the contract checks everything.
 *
 * Automatic steps (groupsHousekeeping, every tick):
 * - every batch that has joins or leaves gets a price window request (kind 20, nonce = batch) as
 *   soon as its first request is seen, so the samplers measure the 30 s after the batch closes;
 *   the agreed price is sent with `clear` (pots.ts submitReady), strictly in batch order;
 * - a batch with no agreed price 10 minutes after its window: `failBatch` (every request back);
 * - after the market closes: the outcome proposal (openOutcome), then `settle`;
 * - no result by the deadline: `voidLate`.
 * Groups live in the shared tables at 9e9 + their on-chain id (ropes.ts GROUP_BASE).
 */
import { encodeFunctionData, getAddress, parseEventLogs, type Address, type Hex, type LocalAccount } from "viem";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { rowBySymbol } from "./catalog";
import { groupsAbi } from "./groupsAbi";
import { memoCall } from "./memo";
import { marketOf, openOutcome, POT_MIN_SAMPLES, POT_WINDOW_S, potParams, recordPotEvent, registerMarket, requestDepthV2 } from "./pots";
import { groupDbId } from "./ropes";
import { paramsFor } from "./trigger/params";
import { rowsWhileUnchanged } from "./rowCache";
import { sendRelayCalls } from "./txs";

export const GROUP_STATES = ["None", "Open", "Settled", "Void"] as const;

/**
 * Only groups priced by HonorCat's own MedianResolver are shown, offered or kept by the relay: the
 * contract lets a creator name any resolver, and one of their own could sign any result.
 */
const OURS = () => `lower(data->>'resolver') = '${(getConfig().groups?.median ?? "0x").toLowerCase()}'`;
export const GROUP_PERIOD_S = 60;
export const GROUP_ATTEST_TIMEOUT_S = 600;
export const GROUP_GRACE_S = 7 * 24 * 3600;
export const GROUP_MAX_NOTIONAL = 100_000_000n;
export const KIND_BATCH = 20;
const NONE = (1n << 64n) - 1n;

export function groupsAddress(): Address | null {
  return getConfig().groups?.address ?? null;
}

const jsonify = (v: unknown): unknown =>
  typeof v === "bigint" ? v.toString() : Array.isArray(v) ? v.map(jsonify) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, jsonify(x)])) : v;

type GroupStruct = {
  conditionId: Hex;
  resolver: Address;
  creator: Address;
  createdAt: bigint;
  closeTime: bigint;
  deadline: bigint;
  window: number;
  minSamples: number;
  state: number;
  outcome: number;
  nextBatch: bigint;
  cap: bigint;
  balance: bigint;
};

export type GroupRow = {
  group_id: string;
  state: number;
  creator: string;
  condition_id: string;
  close_time: string;
  next_batch: string | null;
  data: Record<string, unknown> | string;
};
export const groupData = (r: GroupRow) => {
  const d = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as Record<string, unknown> & { teams: Record<string, string>[]; names: [string, string] | null; createdAt: string; window: string };
  return { ...d, names: (d.names ?? ["Yes", "No"]) as [string, string] } as Record<string, unknown> & { teams: Record<string, string>[]; names: [string, string]; createdAt: string; window: string };
};

/** Reads a group (and both teams) from the chain into `groups`. */
export async function syncGroup(db: Db, groupId: bigint) {
  const address = groupsAddress();
  if (!address) return null;
  const c = publicClient();
  const g = (await c.readContract({ address, abi: groupsAbi, functionName: "group", args: [groupId] })) as unknown as GroupStruct;
  if (Number(g.state) === 0) return null;
  const [t0, t1] = await Promise.all([0, 1].map((t) => c.readContract({ address, abi: groupsAbi, functionName: "team", args: [groupId, t] })));
  const prev = (await db.query<{ data: Record<string, unknown> | string }>("SELECT data FROM groups WHERE group_id = $1", [groupId.toString()]))[0];
  const prevData = prev ? (typeof prev.data === "string" ? JSON.parse(prev.data) : prev.data) : null;
  // The team names come from the creation event (not stored on chain as state).
  let names = (prevData?.names as [string, string] | undefined) ?? null;
  if (!names) {
    const ev = (await db.query<{ args: Record<string, string> }>("SELECT args FROM pot_events WHERE event_name = 'Group:GroupCreated' AND pot_id = $1 LIMIT 1", [groupDbId(groupId)]))[0];
    if (ev) names = [String(ev.args.yesName), String(ev.args.noName)];
  }
  // Names from the creation event; until it is indexed none are stored (read with a fallback).
  const data = { ...(jsonify(g) as Record<string, unknown>), teams: [jsonify(t0), jsonify(t1)], names };
  await db.query(
    `INSERT INTO groups (group_id, state, creator, condition_id, close_time, next_batch, data) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (group_id) DO UPDATE SET state = EXCLUDED.state, next_batch = EXCLUDED.next_batch, data = EXCLUDED.data, updated_at = now()`,
    [groupId.toString(), Number(g.state), g.creator.toLowerCase(), g.conditionId.toLowerCase(), g.closeTime.toString(), g.nextBatch === NONE ? null : g.nextBatch.toString(), JSON.stringify(data)],
  );
  return data;
}

/** Reads one member's standing in a group into `group_members` (position, request, leave, claimable). */
export async function syncMember(db: Db, groupId: bigint, account: Address) {
  const address = groupsAddress();
  if (!address) return null;
  const c = publicClient();
  const [pos, req, ex, cl] = await Promise.all([
    c.readContract({ address, abi: groupsAbi, functionName: "positionOf", args: [groupId, account] }) as Promise<readonly [boolean, number, bigint, bigint]>,
    c.readContract({ address, abi: groupsAbi, functionName: "requests", args: [groupId, account] }) as Promise<readonly [bigint, number, boolean, boolean, bigint, bigint, bigint, bigint]>,
    c.readContract({ address, abi: groupsAbi, functionName: "exits", args: [groupId, account] }) as Promise<readonly [boolean, bigint, bigint]>,
    c.readContract({ address, abi: groupsAbi, functionName: "claimable", args: [groupId, account] }) as Promise<bigint>,
  ]);
  const [active, team, notional, pending] = pos;
  const [rBatch, rTeam, rWait, rActive, rEscrow] = req;
  const [eActive, eBatch, eX] = ex;
  const t = active ? Number(team) : rActive ? Number(rTeam) : eActive ? Number(team) : null;
  const data = {
    position: { active, notional: notional.toString(), pending: pending.toString() },
    request: rActive ? { batch: rBatch.toString(), wait: rWait, escrow: rEscrow.toString() } : null,
    exit: eActive ? { batch: eBatch.toString(), notional: eX.toString() } : null,
    claimable: cl.toString(),
  };
  const member = active || rActive || eActive;
  await db.query(
    `INSERT INTO group_members (group_id, account, team, member, data) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (group_id, account) DO UPDATE SET team = COALESCE(EXCLUDED.team, group_members.team), member = EXCLUDED.member, data = EXCLUDED.data, updated_at = now()`,
    [groupId.toString(), account.toLowerCase(), t, member, JSON.stringify(data)],
  );
  return { team: t, member, ...data };
}

async function syncMembers(db: Db, groupId: bigint) {
  const rows = await db.query<{ account: string }>("SELECT account FROM group_members WHERE group_id = $1 AND (member OR (data->>'claimable')::numeric > 0)", [groupId.toString()]);
  for (let i = 0; i < rows.length; i += 5) await Promise.all(rows.slice(i, i + 5).map((r) => syncMember(db, groupId, getAddress(r.account)).catch(() => null)));
}

/** Reads new HonorCatGroups logs (own cursor) and refreshes every group and member they touch. */
export async function indexGroups(db: Db, head: bigint, opts: { deadlineMs?: number } = {}) {
  const cfg = getConfig().groups;
  if (!cfg) return null;
  const c = publicClient();
  const started = Date.now();
  const cursor = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'groups_cursor'");
  let from = cursor[0] ? BigInt(cursor[0].value) + 1n : cfg.deployBlock;
  const touched = new Set<string>();
  const whole = new Set<string>(); // groups whose every member changed (a clearing, a settlement)
  const people = new Map<string, { gid: bigint; who: Address }>();
  const times = new Map<bigint, number>();
  while (from <= head && Date.now() - started < (opts.deadlineMs ?? 10_000)) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await c.getLogs({ address: cfg.address, fromBlock: from, toBlock: to });
    for (const l of parseEventLogs({ abi: groupsAbi, logs })) {
      const a = l.args as { groupId?: bigint; account?: Address; from?: Address; to?: Address };
      if (typeof a.groupId !== "bigint") continue;
      const gid = a.groupId;
      touched.add(gid.toString());
      for (const w of [a.account, a.from, a.to]) if (w) people.set(`${gid}:${w.toLowerCase()}`, { gid, who: getAddress(w) });
      if (l.eventName === "BatchCleared" || l.eventName === "BatchFailed" || l.eventName === "GroupSettled" || l.eventName === "GroupVoided") whole.add(gid.toString());
      let t = times.get(l.blockNumber);
      if (t === undefined) {
        t = Number((await c.getBlock({ blockNumber: l.blockNumber })).timestamp);
        times.set(l.blockNumber, t);
      }
      await recordPotEvent(db, { ...l, eventName: `Group:${l.eventName}` }, BigInt(groupDbId(gid)), t, "rpc");
    }
    await db.query("INSERT INTO relay_state (key, value) VALUES ('groups_cursor', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [to.toString()]);
    from = to + 1n;
  }
  for (const id of touched) await syncGroup(db, BigInt(id)).catch((e) => console.error("[groups] sync", id, (e as Error).message.slice(0, 200)));
  for (const { gid, who } of people.values()) if (!whole.has(gid.toString())) await syncMember(db, gid, who).catch(() => null);
  for (const { gid, who } of people.values()) if (whole.has(gid.toString())) await syncMember(db, gid, who).catch(() => null);
  for (const id of whole) await syncMembers(db, BigInt(id)).catch(() => null);
  return { touched: touched.size };
}

/** The price window of batch k (the contract's windowOf, from the stored group). */
export function windowOfBatch(d: { createdAt: string | number; window: string | number }, k: bigint) {
  const start = Number(d.createdAt) + (Number(k) + 1) * GROUP_PERIOD_S;
  return { start, end: start + Number(d.window) };
}

const lastSync = new Map<string, number>();

/** One pass over open groups: open price windows, fail stuck batches, settle or void. */
export async function groupsHousekeeping(db: Db, own: LocalAccount | null) {
  const cfg = getConfig().groups;
  if (!cfg) return { checked: 0, calls: 0 };
  // Re-read only when a group changed (a one-line fingerprint first): every byte read leaves the database.
  const rows = await rowsWhileUnchanged<GroupRow>(
    db,
    "house:groups",
    `SELECT count(*)::text || ':' || coalesce(max(updated_at)::text, '') AS fp FROM groups WHERE state = 1 AND ${OURS()}`,
    `SELECT group_id::text AS group_id, state, creator, condition_id, close_time::text AS close_time, next_batch::text AS next_batch, data FROM groups WHERE state = 1 AND ${OURS()}`,
  );
  const now = Math.floor(Date.now() / 1000);
  let calls = 0;
  for (const row of rows) {
    try {
      // Re-read each open group from the chain at least once a minute: a refresh that failed after an
      // event (an RPC limit) must not leave a stale next batch without a price request.
      if (Date.now() - (lastSync.get(row.group_id) ?? 0) > 60_000) {
        lastSync.set(row.group_id, Date.now());
        await syncGroup(db, BigInt(row.group_id)).catch(() => null);
      }
      const d = groupData(row);
      const gid = BigInt(row.group_id);
      const dbId = groupDbId(gid);
      // 1. A window request for every batch with requests (from the events), before its window starts.
      const batches = await db.query<{ batch: string }>(
        `SELECT DISTINCT args->>'batch' AS batch FROM pot_events
          WHERE pot_id = $1 AND event_name IN ('Group:JoinRequested','Group:LeaveRequested') AND block_time > $2`,
        [dbId, now - 3600],
      );
      // The batch due next too: waiting joins carry into later batches with no new event of their own.
      const due = new Set(batches.map((b) => b.batch));
      if (row.next_batch !== null) {
        due.add(row.next_batch);
        // Waiting joins carry on into the batch after: ask for its price ahead, so the samplers
        // measure its whole window (a request made only after this batch clears could come late).
        if (d.teams.some((t) => String(t.carryBase ?? "0") !== "0")) due.add((BigInt(row.next_batch) + 1n).toString());
      }
      for (const kb of due) {
        const k = BigInt(kb);
        const w = windowOfBatch(d, k);
        if (w.end < now - GROUP_ATTEST_TIMEOUT_S) continue;
        await db.query(`INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`, [
          `g:${gid}:${k}`,
          dbId,
          JSON.stringify({
            kind: KIND_BATCH,
            nonce: k.toString(),
            windowStart: w.start,
            windowEnd: w.end,
            conditionId: row.condition_id,
            minSamples: Number(d.minSamples),
            resolver: String(d.resolver).toLowerCase(),
            contract: cfg.address.toLowerCase(),
            name: "HonorCatGroups",
            chainPotId: gid.toString(),
          }),
        ]);
      }
      let data: Hex | null = null;
      let why = "";
      // 2. The batch due next got no agreed price in time: every request in it goes back.
      if (row.next_batch !== null) {
        const w = windowOfBatch(d, BigInt(row.next_batch));
        if (now > w.end + GROUP_ATTEST_TIMEOUT_S + 5) {
          data = encodeFunctionData({ abi: groupsAbi, functionName: "failBatch", args: [gid] });
          why = `batch ${row.next_batch} got no price in time: requests back`;
        }
      }
      // 3. After the close: propose the result (the samplers co-sign, then settle); late: void.
      if (!data && now >= Number(row.close_time)) {
        if (now > Number(d.deadline)) {
          data = encodeFunctionData({ abi: groupsAbi, functionName: "voidLate", args: [gid] });
          why = "no result by the deadline: deposits back";
        } else await openOutcome(db, BigInt(dbId), row.condition_id, own).catch((e) => console.error("[groups] outcome", row.group_id, (e as Error).message.slice(0, 200)));
      }
      if (!data) continue;
      const ref = `group-${gid}`;
      const res = await sendRelayCalls(db, "pot_house", [{ ...memoCall(cfg.address, data, ref, { v: 1, t: "pot", ref, pot: dbId, why }), potIds: [], label: `group ${gid}: ${why}` }]);
      calls++;
      // Re-read either way: a refused send usually means the group moved on.
      await syncGroup(db, gid).catch(() => {});
      if (!res.ok) lastSync.set(row.group_id, Date.now());
    } catch (e) {
      console.error("[groups] housekeeping", row.group_id, (e as Error).message.slice(0, 200));
    }
  }
  return { checked: rows.length, calls };
}

/**
 * The batch the group clears next (clear() must go strictly in order): null when the group is no
 * longer open; past every batch so far when nothing is waiting.
 */
export async function nextBatchOf(groupId: bigint): Promise<bigint | null> {
  const address = groupsAddress();
  if (!address) return null;
  const g = (await publicClient().readContract({ address, abi: groupsAbi, functionName: "group", args: [groupId] })) as unknown as GroupStruct;
  if (Number(g.state) !== 1) return null;
  return g.nextBatch;
}

/** Everything the browser needs to create a group on a market (depth attestation for the groups contract). */
export async function prepareGroup(db: Db, input: { symbol: string; account: Address }, own: LocalAccount | null) {
  const g = getConfig().groups;
  if (!g) throw Object.assign(new Error("group pots are not deployed"), { status: 409 });
  const row = await rowBySymbol(db, input.symbol);
  if (!row) throw Object.assign(new Error("unknown market"), { status: 404 });
  const closeTime = Math.floor(row.closeMs / 1000);
  if (row.closeMs - Date.now() < 15 * 60_000) throw Object.assign(new Error("this market closes too soon for a group"), { status: 409 });
  const params = potParams(paramsFor("demo"), POT_WINDOW_S, POT_MIN_SAMPLES);
  const conditionId = await registerMarket(db, { instrument: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, params });
  const crypto = row.category === "Crypto";
  const { id, depth } = await requestDepthV2(db, { conditionId, account: input.account, instrument: row.symbol, closeTime, crypto }, own, {
    chainId: getConfig().chainId,
    pots: g.address,
    name: "HonorCatGroups",
  });
  const b = row.book?.bid != null && row.book?.ask != null ? row.book : row;
  const mid = b.bid != null && b.ask != null ? (b.bid + b.ask) / 2 : null;
  const cap = BigInt(depth.contracts5c) * 2_500n;
  return {
    conditionId,
    resolver: g.median,
    groups: g.address,
    chainId: getConfig().chainId,
    closeTime,
    window: POT_WINDOW_S,
    minSamples: POT_MIN_SAMPLES,
    grace: GROUP_GRACE_S,
    depthId: id,
    depth,
    cap: (cap < GROUP_MAX_NOTIONAL ? cap : GROUP_MAX_NOTIONAL).toString(),
    crypto,
    midPpm: mid === null ? null : Math.round(mid * 1e6),
    market: { symbol: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, category: row.category, closeMs: row.closeMs },
  };
}

/** A group for its page: state, teams, members per team, recent batches, and one account's standing. */
export async function groupDetail(db: Db, groupId: string, account?: string | null) {
  const row = (
    await db.query<GroupRow>(
      `SELECT group_id::text AS group_id, state, creator, condition_id, close_time::text AS close_time, next_batch::text AS next_batch, data FROM groups WHERE group_id = $1 AND ${OURS()}`,
      [groupId],
    )
  )[0];
  if (!row) return null;
  const d = groupData(row);
  const dbId = groupDbId(groupId);
  const counts = await db.query<{ team: number; n: string }>("SELECT team, count(*)::text AS n FROM group_members WHERE group_id = $1 AND member AND team IS NOT NULL GROUP BY team", [groupId]);
  const members = [0, 1].map((t) => Number(counts.find((c) => Number(c.team) === t)?.n ?? 0));
  const cleared = await db.query<{ args: Record<string, string>; tx_hash: string; block_time: string | null }>(
    "SELECT args, tx_hash, block_time::text AS block_time FROM pot_events WHERE pot_id = $1 AND event_name = 'Group:BatchCleared' ORDER BY block_number DESC, log_index DESC LIMIT 60",
    [dbId],
  );
  const pricing = await db.query<{ id: string; status: string; nonce: string; ws: string; we: string; error: string | null }>(
    `SELECT id, status, payload->>'nonce' AS nonce, payload->>'windowStart' AS ws, payload->>'windowEnd' AS we, error
       FROM att_requests WHERE pot_id = $1 AND kind = 'window' AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 5`,
    [dbId],
  );
  const market = await marketOf(db, row.condition_id);
  // The newest events, for "Mochi joined Texas with $5" lines (names are added in the browser).
  const recent = await db.query<{ event_name: string; args: Record<string, string>; block_time: string | null; tx_hash: string }>(
    "SELECT event_name, args, block_time::text AS block_time, tx_hash FROM pot_events WHERE pot_id = $1 ORDER BY block_number DESC, log_index DESC LIMIT 20",
    [dbId],
  );
  let mine = null;
  // Only an account that took part (a member row or an event of its own) is read from the chain:
  // a visitor's page view must not cost four chain reads and a database write.
  if (account && /^0x[0-9a-fA-F]{40}$/.test(account)) {
    const a = account.toLowerCase();
    const took = await db.query(
      "SELECT 1 FROM group_members WHERE group_id = $1 AND account = $2 UNION ALL SELECT 1 FROM pot_events WHERE pot_id = $3 AND lower(args->>'account') = $2 LIMIT 1",
      [groupId, a, dbId],
    );
    if (took.length) mine = await syncMember(db, BigInt(groupId), getAddress(account)).catch(() => null);
  }
  const now = Math.floor(Date.now() / 1000);
  const createdAt = Number(d.createdAt);
  const currentBatch = now >= createdAt ? Math.floor((now - createdAt) / GROUP_PERIOD_S) : 0;
  return {
    groupId: row.group_id,
    state: GROUP_STATES[row.state],
    creator: row.creator,
    conditionId: row.condition_id,
    closeTime: Number(row.close_time),
    deadline: Number(d.deadline),
    createdAt,
    window: Number(d.window),
    cap: String(d.cap),
    outcome: Number(d.outcome),
    names: d.names,
    lines: await groupLines(db, groupId),
    nextBatch: row.next_batch,
    teams: d.teams.map((t, i) => ({ pool: String(t.pool), exiting: String(t.exiting), deposits: String(t.deposits), members: members[i] })),
    // batches close every minute on the group's own clock; the current one clears after its window
    clock: { now, currentBatch, collectingUntil: createdAt + (currentBatch + 1) * GROUP_PERIOD_S, window: windowOfBatch(d, BigInt(currentBatch)) },
    prices: cleared.map((e) => ({ batch: e.args.batch, price: Number(e.args.price), matched: e.args.matched, at: e.block_time ? Number(e.block_time) : null, tx: e.tx_hash })).reverse(),
    events: recent.map((e) => ({ name: e.event_name.replace(/^Group:/, ""), args: e.args, at: e.block_time ? Number(e.block_time) : null, tx: e.tx_hash })),
    pricing: pricing.map((p) => ({ id: p.id, status: p.status, batch: p.nonce, windowStart: Number(p.ws), windowEnd: Number(p.we), error: p.error })),
    market: market && { instrument: market.instrument, eventTicker: market.eventTicker, contractTicker: market.contractTicker, eventTitle: market.eventTitle, label: market.label },
    mine,
  };
}

/** Groups for the lists: open first, newest first. */
export async function listGroups(db: Db, opts: { account?: string | null; limit?: number } = {}) {
  const rows = opts.account
    ? await db.query<GroupRow>(
        `SELECT g.group_id::text AS group_id, g.state, g.creator, g.condition_id, g.close_time::text AS close_time, g.next_batch::text AS next_batch, g.data
           FROM groups g JOIN group_members m ON m.group_id = g.group_id
          WHERE m.account = $1 AND (m.member OR (m.data->>'claimable')::numeric > 0) AND lower(g.data->>'resolver') = '${(getConfig().groups?.median ?? "0x").toLowerCase()}'
          ORDER BY g.state, g.group_id DESC LIMIT $2`,
        [opts.account.toLowerCase(), opts.limit ?? 50],
      )
    : await db.query<GroupRow>(
        `SELECT group_id::text AS group_id, state, creator, condition_id, close_time::text AS close_time, next_batch::text AS next_batch, data FROM groups WHERE ${OURS()} ORDER BY state, group_id DESC LIMIT $1`,
        [opts.limit ?? 50],
      );
  const counts = await db.query<{ group_id: string; team: number; n: string }>(
    "SELECT group_id::text AS group_id, team, count(*)::text AS n FROM group_members WHERE member AND team IS NOT NULL AND group_id = ANY($1::bigint[]) GROUP BY group_id, team",
    [rows.map((r) => r.group_id)],
  );
  return rows.map((r) => {
    const d = groupData(r);
    return {
      groupId: r.group_id,
      state: GROUP_STATES[r.state],
      conditionId: r.condition_id,
      closeTime: Number(r.close_time),
      names: d.names,
      pools: d.teams.map((t) => String(t.pool)),
      members: [0, 1].map((t) => Number(counts.find((c) => c.group_id === r.group_id && Number(c.team) === t)?.n ?? 0)),
    };
  });
}

/** The group id from a transaction's GroupCreated event. */
export async function groupIdFrom(tx: Hex): Promise<string | null> {
  const receipt = await publicClient().waitForTransactionReceipt({ hash: tx, timeout: 60_000 }).catch(() => null);
  const ev = receipt ? parseEventLogs({ abi: groupsAbi, logs: receipt.logs, eventName: "GroupCreated" })[0] : undefined;
  return ev ? (ev.args as { groupId: bigint }).groupId.toString() : null;
}

/** Group pots are shown to players only with GROUPS=on (the relay clears existing groups regardless). */
export const groupsOn = () => (process.env.GROUPS ?? "").toLowerCase() === "on";

/** Whether groups can be created here, and the contract (for the browser). */
export function groupsStatus() {
  const g = getConfig().groups;
  return { available: Boolean(g), on: Boolean(g) && groupsOn(), address: g?.address ?? null, period: GROUP_PERIOD_S, maxWaitBatches: 20, exitFeeBps: 100, minJoin: "100000", maxNotional: GROUP_MAX_NOTIONAL.toString() };
}

/**
 * Each team's short line ("Texas fans since 1990"), written once by the creator right after the
 * group opens. They move no money and are kept off-chain; the first write within 15 minutes wins.
 */
export const linesMessage = (groupId: string, account: string, lines: [string, string], issuedAt: string) =>
  `HonorCat: the team lines of group ${groupId}: "${lines[0]}" / "${lines[1]}".
Account: ${getAddress(account)}
Issued: ${issuedAt}`;

export async function setGroupLines(
  db: Db,
  input: { groupId: string; account: Address; lines: [string, string]; issuedAt: string } & ({ signature: Hex } | { passkey: import("./passkeys").WebAuthnAssertion }),
) {
  const { groupId } = input;
  const row = (await db.query<GroupRow>("SELECT group_id::text AS group_id, state, creator, condition_id, close_time::text AS close_time, next_batch::text AS next_batch, data FROM groups WHERE group_id = $1", [groupId]))[0];
  if (!row) throw Object.assign(new Error("no such group"), { status: 404 });
  const account = getAddress(input.account);
  if (row.creator !== account.toLowerCase()) throw Object.assign(new Error("only the group's creator writes the team lines"), { status: 403 });
  if (Date.now() / 1000 - Number(groupData(row).createdAt) > 15 * 60) throw Object.assign(new Error("team lines are set only right after the group opens"), { status: 409 });
  const issued = Date.parse(input.issuedAt);
  if (!Number.isFinite(issued) || Math.abs(Date.now() - issued) > 10 * 60_000) throw Object.assign(new Error("the signed request is too old; sign again"), { status: 401 });
  // Signed by the creator (wallet signature or passkey): an address alone proves nothing.
  const message = linesMessage(groupId, account, input.lines, input.issuedAt);
  if ("signature" in input) {
    if (!(await publicClient().verifyMessage({ address: account, message, signature: input.signature }))) throw Object.assign(new Error("signature does not match the account"), { status: 401 });
  } else await (await import("./passkeys")).verifyPasskeyJoin(db, account, message, input.passkey);
  const clean = input.lines.map((l) => l.replace(/\s+/g, " ").trim().slice(0, 80)) as [string, string];
  await db.query("INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING", [`group_lines:${groupId}`, JSON.stringify(clean)]);
  return { ok: true };
}

export async function groupLines(db: Db, groupId: string): Promise<[string, string] | null> {
  const r = (await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [`group_lines:${groupId}`]))[0];
  return r ? (JSON.parse(r.value) as [string, string]) : null;
}

/** Group logs delivered by QuickNode Streams: recorded at once (source "streams"), then the read model. */
export async function ingestGroupLogs(db: Db, logs: { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number }[], blockTime: (n: bigint) => Promise<number | null>) {
  const cfg = getConfig().groups;
  if (!cfg) return { received: 0 };
  const ours = logs.filter((l) => l.address.toLowerCase() === cfg.address.toLowerCase());
  const dec = parseEventLogs({ abi: groupsAbi, logs: ours.map((l) => ({ ...l, blockHash: null, transactionIndex: null, removed: false })) as never });
  const touched = new Map<string, Set<string>>();
  for (const l of dec) {
    const a = l.args as { groupId?: bigint; account?: Address; from?: Address; to?: Address };
    if (typeof a.groupId !== "bigint") continue;
    const set = touched.get(a.groupId.toString()) ?? new Set<string>();
    for (const w of [a.account, a.from, a.to]) if (w) set.add(getAddress(w));
    touched.set(a.groupId.toString(), set);
    await recordPotEvent(db, { ...l, eventName: `Group:${l.eventName}` } as never, BigInt(groupDbId(a.groupId)), await blockTime(l.blockNumber!).catch(() => null), "streams");
  }
  for (const [gid, who] of touched) {
    await syncGroup(db, BigInt(gid)).catch((e) => console.error("[groups] sync", gid, (e as Error).message.slice(0, 200)));
    for (const w of who) await syncMember(db, BigInt(gid), w as Address).catch(() => null);
  }
  return { received: dec.length };
}
