/**
 * Relay for two-sided pots (HonorCatPots). It never decides a price itself: samplers measure and
 * sign, the relay checks, aggregates by a fixed rule and submits. Anyone else could do the same with
 * the same signatures (the contract checks them, not the relay).
 *
 * Window attestations (join, exit, net, bowl), per docs/pot-design.md 4:
 * 1. A pot enters Joining or ExitRequested: the relay opens a request for that exact window.
 * 2. Each sampler measures the window from its own book readings, builds its evidence record and
 *    signs the record hash (its own average). The relay verifies the record (`verifyRecord`).
 * 3. Proposal: three valid averages → their exact median; two → their mean, only if within 0.5
 *    points; otherwise `valid = false` (the join or exit does not happen). The evidence hash is the
 *    root of the signers' record hashes, so anyone can check the relay had no discretion.
 * 4. Each sampler co-signs the proposal only if it is within 0.5 points of its own average.
 * 5. With M co-signatures (ascending signer order, the MultisigResolver format) the relay submits.
 */
import { GEMINI_REST } from "./gemini";
import { nativeToUsdcUnits } from "./arc";
import { randomUUID } from "node:crypto";
import {
  concat,
  encodeFunctionData,
  getAddress,
  parseEventLogs,
  hashTypedData,
  encodeAbiParameters,
  verifyTypedData,
  recoverAddress,
  verifyMessage,
  type Address,
  type Hex,
  type LocalAccount,
} from "viem";
import { publicClient } from "./chain";
import { getConfig } from "./config";
import type { Db } from "./db";
import { fetchMarketState, readBook } from "./gemini";
import { bookStats, rowBySymbol } from "./catalog";
import { decodeMemoBody, decodeMemoLog, memoCall } from "./memo";
import { ARC_MEMO } from "./arc";
import { potsAbi } from "./potsAbi";
import { ropesAbi } from "./ropesAbi";
import { ATTEST_TIMEOUT_S, EXPIRY_TRIES, KIND_EXPIRY, KIND_KNOCK, chainPotId, contractOf, deploymentOf, domainNameFor, expiryWindowStart, isRopeDbId, knockWindowOk, ropeDbId } from "./ropes";
import { notifyPot, stateMessage } from "./push";
import { sendRelayCalls } from "./txs";
import { evidenceHash, evidenceRootOf, recordFromJson, verifyRecord } from "./trigger/evidence";
import { conditionIdForTrigger, paramsFor, type TriggerParams } from "./trigger/params";

export const POT_STATES = ["None", "Open", "Joining", "Live", "ExitRequested", "Divided", "Settled", "Expired"] as const;
export type PotState = (typeof POT_STATES)[number];
export const KIND = { join: 0, exit: 1, netYes: 2, netNo: 3, bowlYes: 4, bowlNo: 5, quote: 6, knock: 7, expiry: 8 } as const;
export const AGREE_PPM = 5_000n; // 0.5 points
export const P = 1_000_000n;
export const DELAY = 1; // seconds, matches the contract

/** Where an attestation is checked: chain, contract and (v2) the contract's EIP-712 name. */
export type At = { chainId: number; pots: Address; name?: "HonorCatPots" | "HonorCatRopes" };
const domain = (chainId: number, verifyingContract: Address, name?: string) => ({ name: name ?? domainNameFor(verifyingContract), version: "1", chainId, verifyingContract });
const domainOf = (at?: At) => (at ? domain(at.chainId, at.pots, at.name) : domain(getConfig().chainId, potsAddress()));
/** The `At` of a database pot id (v1 or v2). */
export function atOf(dbId: string | bigint): At {
  const c = contractOf(dbId);
  return { chainId: getConfig().chainId, pots: c.address, name: c.name };
}

const windowTypes = {
  Window: [
    { name: "potId", type: "uint256" },
    { name: "kind", type: "uint8" },
    { name: "nonce", type: "uint64" },
    { name: "windowStart", type: "uint64" },
    { name: "windowEnd", type: "uint64" },
    { name: "sampleCount", type: "uint32" },
    { name: "priceYes", type: "uint32" },
    { name: "valid", type: "bool" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;
const depthTypes = {
  Depth: [
    { name: "conditionId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "contracts5c", type: "uint64" },
    { name: "closeTime", type: "uint64" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;
const depthTypesV2 = {
  Depth: [
    { name: "conditionId", type: "bytes32" },
    { name: "account", type: "address" },
    { name: "contracts5c", type: "uint64" },
    { name: "spread", type: "uint32" },
    { name: "crypto", type: "bool" },
    { name: "closeTime", type: "uint64" },
    { name: "validUntil", type: "uint64" },
  ],
} as const;
const outcomeTypes = {
  Outcome: [
    { name: "potId", type: "uint256" },
    { name: "conditionId", type: "bytes32" },
    { name: "outcome", type: "uint8" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

export type WindowAtt = { potId: string; kind: number; nonce: string; windowStart: string; windowEnd: string; sampleCount: number; priceYes: number; valid: boolean; evidenceHash: Hex };
export type DepthAtt = { conditionId: Hex; account: Address; contracts5c: string; closeTime: string; validUntil: string; /** v2 only */ spread?: number; crypto?: boolean };
export type OutcomeAtt = { potId: string; conditionId: Hex; outcome: number; evidenceHash: Hex };

export function potsAddress(): Address {
  const p = getConfig().pots;
  if (!p) throw new Error("HonorCatPots is not configured (POTS_ADDRESS or deployments/<chain>.pots.json)");
  return p.address;
}

function signerSet() {
  const e = getConfig().early;
  if (!e) throw new Error("the sampler signer set is not configured (RESOLVER_ADDRESS, SAMPLERS)");
  return e;
}

export function windowDigest(a: WindowAtt, at?: At): Hex {
  return hashTypedData({
    domain: domainOf(at),
    types: windowTypes,
    primaryType: "Window",
    message: {
      potId: BigInt(a.potId),
      kind: a.kind,
      nonce: BigInt(a.nonce),
      windowStart: BigInt(a.windowStart),
      windowEnd: BigInt(a.windowEnd),
      sampleCount: a.sampleCount,
      priceYes: a.priceYes,
      valid: a.valid,
      evidenceHash: a.evidenceHash,
    },
  });
}

export function depthDigest(d: DepthAtt, at?: At): Hex {
  const dom = domainOf(at);
  if (dom.name === "HonorCatRopes") {
    return hashTypedData({
      domain: dom,
      types: depthTypesV2,
      primaryType: "Depth",
      message: { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), spread: d.spread ?? 0, crypto: d.crypto ?? false, closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) },
    });
  }
  return hashTypedData({
    domain: dom,
    types: depthTypes,
    primaryType: "Depth",
    message: { conditionId: d.conditionId, account: d.account, contracts5c: BigInt(d.contracts5c), closeTime: BigInt(d.closeTime), validUntil: BigInt(d.validUntil) },
  });
}

export function outcomeDigest(o: OutcomeAtt, at?: At): Hex {
  return hashTypedData({
    domain: domainOf(at),
    types: outcomeTypes,
    primaryType: "Outcome",
    message: { potId: BigInt(o.potId), conditionId: o.conditionId, outcome: o.outcome, evidenceHash: o.evidenceHash },
  });
}

/* ------------------------------------------------------------------ the agreement rule (pure) */

export type Avg = { signer: Address; ppm: bigint; valid: boolean; sampleCount: number; evidenceHash: Hex };
export type Proposal = { valid: boolean; ppm: bigint; used: Avg[]; reason: string };

/**
 * Three valid averages: the exact median. Two: their mean (floored), only if within 0.5 points.
 * Anything else: no agreement (`valid = false`): the join or exit does not happen.
 */
export function propose(avgs: Avg[]): Proposal {
  const ok = avgs.filter((a) => a.valid).sort((a, b) => (a.ppm < b.ppm ? -1 : a.ppm > b.ppm ? 1 : 0));
  if (ok.length >= 3) {
    const m = ok[Math.floor((ok.length - 1) / 2)]!;
    if (ok.length % 2 === 1) return { valid: true, ppm: m.ppm, used: ok, reason: "median of three" };
  }
  if (ok.length === 2) {
    const d = ok[1]!.ppm - ok[0]!.ppm;
    if (d <= AGREE_PPM) return { valid: true, ppm: (ok[0]!.ppm + ok[1]!.ppm) / 2n, used: ok, reason: "mean of two within 0.5 points" };
    return { valid: false, ppm: 0n, used: ok, reason: `two samplers ${Number(d) / 10_000} points apart` };
  }
  return { valid: false, ppm: 0n, used: avgs, reason: ok.length < 2 ? "fewer than two valid windows" : "no agreement" };
}

/**
 * Gemini's own status gates every price: only an active contract whose market is open counts.
 * Halted, under review, closed, settled or unreachable: no price, so nothing moves.
 * Returns the reason when blocked, null when the market is open.
 */
export function marketGate(st: { status: string; marketState: string | null } | null): string | null {
  if (!st) return "market status unreachable";
  if (st.status !== "active") return `market ${st.status}`;
  if (st.marketState && st.marketState !== "open") return `market ${st.marketState}`;
  return null;
}

/** A sampler co-signs a valid proposal only within 0.5 points of its own average; an invalid one always. */
export function wouldCosign(own: { ppm: bigint; valid: boolean } | null, att: { valid: boolean; priceYes: number }): boolean {
  if (!att.valid) return true;
  if (!own || !own.valid) return false;
  const d = own.ppm > BigInt(att.priceYes) ? own.ppm - BigInt(att.priceYes) : BigInt(att.priceYes) - own.ppm;
  return d <= AGREE_PPM;
}

/** Evidence root over the used records, ascending signer order (the existing construction). */
export function rootOf(used: Avg[]): Hex {
  const sorted = [...used].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  return evidenceRootOf(sorted.map((a) => a.evidenceHash));
}

/* ------------------------------------------------------------------ the rule for a market */

/** The rule a pot's market is measured with; its conditionId commits to instrument and rule. */
export function potParams(base: TriggerParams, windowS: number, minSamples: number): TriggerParams {
  return { ...base, windowMs: windowS * 1000, intervalMs: 2000, minValidSamples: minSamples, thresholdBps: 5000 };
}

export function potConditionId(instrument: string, params: TriggerParams): Hex {
  return conditionIdForTrigger({ instrument, side: "yes", mode: "early-only", params });
}

const paramsToJson = (p: TriggerParams) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, String(v)]));
const paramsFromJson = (j: Record<string, string>): TriggerParams =>
  Object.fromEntries(Object.entries(j).map(([k, v]) => [k, Number(v)])) as unknown as TriggerParams;

export async function registerMarket(
  db: Db,
  m: { instrument: string; eventTicker: string; contractTicker: string; eventTitle: string; label: string; params: TriggerParams },
): Promise<Hex> {
  const conditionId = potConditionId(m.instrument, m.params);
  await db.query(
    `INSERT INTO pot_markets (condition_id, instrument, event_ticker, contract_ticker, event_title, label, params)
     VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (condition_id) DO NOTHING`,
    [conditionId.toLowerCase(), m.instrument, m.eventTicker, m.contractTicker, m.eventTitle, m.label, JSON.stringify(paramsToJson(m.params))],
  );
  return conditionId;
}

type MarketRow = { condition_id: string; instrument: string; event_ticker: string; contract_ticker: string; event_title: string; label: string; params: Record<string, string> | string };
export async function marketOf(db: Db, conditionId: string) {
  const r = (await db.query<MarketRow>("SELECT * FROM pot_markets WHERE condition_id = $1", [conditionId.toLowerCase()]))[0];
  if (!r) return null;
  const params = paramsFromJson(typeof r.params === "string" ? JSON.parse(r.params) : r.params);
  return { conditionId: r.condition_id as Hex, instrument: r.instrument, eventTicker: r.event_ticker, contractTicker: r.contract_ticker, eventTitle: r.event_title, label: r.label, params };
}

/* ------------------------------------------------------------------ projection from the chain */

type PotStruct = Record<string, unknown>;
const jsonify = (o: PotStruct) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

/** Reads a pot and its owners from the chain into `pots`, and opens the request for a pending window. */
export async function syncPot(db: Db, potId: bigint, createdTx?: string) {
  if (isRopeDbId(potId)) return syncRope(db, potId, createdTx);
  const c = publicClient();
  const address = potsAddress();
  const p = (await c.readContract({ address, abi: potsAbi, functionName: "pot", args: [potId] })) as unknown as PotStruct;
  const state = Number(p.state);
  if (state === 0) return null;
  const owner = async (side: 0 | 1) =>
    c
      .readContract({ address, abi: potsAbi, functionName: "ownerOf", args: [potId * 2n + BigInt(side)] })
      .then((a) => (a as string).toLowerCase())
      .catch(() => null);
  const [yes, no] = await Promise.all([owner(0), owner(1)]);
  const levels = await Promise.all(
    [0n, 1n].map((s) =>
      c
        .readContract({ address, abi: potsAbi, functionName: "levels", args: [potId * 2n + s] })
        .then((l) => {
          const [net, bowl, setAt] = l as readonly [number, number, bigint];
          return { net, bowl, setAt: setAt.toString() };
        })
        .catch(() => null),
    ),
  );
  // Remember the size at creation (nine lives are ninths of it) and the last division's price.
  const prev = (await db.query<{ data: Record<string, unknown> | string }>("SELECT data FROM pots WHERE pot_id = $1", [potId.toString()]))[0];
  const prevData = prev ? ((typeof prev.data === "string" ? JSON.parse(prev.data) : prev.data) as Record<string, unknown>) : null;
  let initialNotional = (prevData?.initialNotional as string | undefined) ?? (String(p.notional) !== "0" ? String(p.notional) : undefined);
  if (!initialNotional) {
    // First seen after a full division: the size at creation is in the PotCreated event.
    const created = await c
      .getContractEvents({ address, abi: potsAbi, eventName: "PotCreated", args: { potId }, fromBlock: getConfig().pots!.deployBlock })
      .catch(() => []);
    initialNotional = created[0] ? String((created[0].args as { notional: bigint }).notional) : "0";
  }
  const data = { ...jsonify(p), levels, initialNotional };
  await db.query(
    `INSERT INTO pots (pot_id, condition_id, state, data, yes_owner, no_owner, created_tx) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (pot_id) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, yes_owner = EXCLUDED.yes_owner,
       no_owner = EXCLUDED.no_owner, created_tx = COALESCE(pots.created_tx, EXCLUDED.created_tx), updated_at = now()`,
    [potId.toString(), String(p.conditionId).toLowerCase(), state, JSON.stringify(data), yes, no, createdTx ?? null],
  );
  // Tell the browsers that asked (web push) when the pot changes state.
  const prevState = prevData ? Number(prevData.state) : null;
  const msg = stateMessage(potId.toString(), prevState, state);
  if (msg && prevData) await notifyPot(db, potId.toString(), msg.title, msg.body).catch((e) => console.error("[push]", e));
  if (state === 2 || state === 4) {
    const kind = state === 2 ? KIND.join : KIND.exit;
    const start = Number(p.requestTime) + DELAY;
    const id = `w:${potId}:${p.nonce}:${kind}`;
    await db.query(
      `INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`,
      [id, potId.toString(), JSON.stringify({ kind, nonce: String(p.nonce), windowStart: start, windowEnd: start + Number(p.window), conditionId: String(p.conditionId).toLowerCase(), minSamples: Number(p.minSamples), resolver: String(p.resolver).toLowerCase() })],
    );
  }
  return { state, data };
}

/**
 * The same for a HonorCat v2 pot (database id = ROPE_BASE + on-chain id): reads HonorCatRopes, keeps
 * the posts, expiry, lives, copy marks and the size at creation, and opens the request for a pending
 * join, exit or knock-out window. Expiry windows are opened by housekeeping (they are fixed by the
 * contract, not by a request).
 */
async function syncRope(db: Db, dbId: bigint, createdTx?: string) {
  const c = publicClient();
  const { address, chainPotId: id } = contractOf(dbId);
  const p = (await c.readContract({ address, abi: ropesAbi, functionName: "pot", args: [id] })) as unknown as PotStruct;
  const state = Number(p.state);
  if (state === 0) return null;
  const owner = async (side: 0 | 1) =>
    c
      .readContract({ address, abi: ropesAbi, functionName: "ownerOf", args: [id * 2n + BigInt(side)] })
      .then((a) => (a as string).toLowerCase())
      .catch(() => null);
  const [yes, no] = await Promise.all([owner(0), owner(1)]);
  const read = (fn: "levels" | "copies", side: bigint) =>
    c.readContract({ address, abi: ropesAbi, functionName: fn, args: [id * 2n + side] }).then((r) => r as unknown as readonly unknown[]);
  const levels = await Promise.all(
    [0n, 1n].map((s) =>
      read("levels", s)
        .then((l) => ({ net: Number(l[0]), bowl: Number(l[1]), setAt: String(l[2]) }))
        .catch(() => null),
    ),
  );
  const copies = await Promise.all(
    [0n, 1n].map((s) =>
      read("copies", s)
        .then((r) => (/^0x0+$/.test(String(r[0])) ? null : { leader: String(r[0]).toLowerCase(), paidIn: String(r[1]), paidOut: String(r[2]), held: String(r[3]) }))
        .catch(() => null),
    ),
  );
  const prev = (await db.query<{ data: Record<string, unknown> | string }>("SELECT data FROM pots WHERE pot_id = $1", [dbId.toString()]))[0];
  const prevData = prev ? ((typeof prev.data === "string" ? JSON.parse(prev.data) : prev.data) as Record<string, unknown>) : null;
  let initialSize = (prevData?.initialSize as string | undefined) ?? (String(p.size) !== "0" ? String(p.size) : undefined);
  if (!initialSize) {
    const created = await c.getContractEvents({ address, abi: ropesAbi, eventName: "PotCreated", args: { potId: id }, fromBlock: deploymentOf(dbId)!.deployBlock }).catch(() => []);
    initialSize = created[0] ? String((created[0].args as { size: bigint }).size) : "0";
  }
  const total = ((BigInt(String(p.upper)) / 100n - BigInt(String(p.lower)) / 100n) * BigInt(String(p.size))).toString();
  const data = { ...jsonify(p), levels, copies, initialSize, v2: true, chainPotId: id.toString(), contract: address.toLowerCase(), potValue: total };
  await db.query(
    `INSERT INTO pots (pot_id, condition_id, state, data, yes_owner, no_owner, created_tx) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (pot_id) DO UPDATE SET state = EXCLUDED.state, data = EXCLUDED.data, yes_owner = EXCLUDED.yes_owner,
       no_owner = EXCLUDED.no_owner, created_tx = COALESCE(pots.created_tx, EXCLUDED.created_tx), updated_at = now()`,
    [dbId.toString(), String(p.conditionId).toLowerCase(), state, JSON.stringify(data), yes, no, createdTx ?? null],
  );
  const prevState = prevData ? Number(prevData.state) : null;
  const msg = stateMessage(dbId.toString(), prevState, state);
  if (msg && prevData) await notifyPot(db, dbId.toString(), msg.title, msg.body).catch((e) => console.error("[push]", e));
  if (state === 2 || state === 4) {
    const kind = state === 2 ? KIND.join : KIND.exit;
    const start = Number(p.requestTime) + DELAY;
    await db.query(
      `INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`,
      [
        `w:${dbId}:${p.nonce}:${kind}`,
        dbId.toString(),
        JSON.stringify({
          kind,
          nonce: String(p.nonce),
          windowStart: start,
          windowEnd: start + Number(p.window),
          conditionId: String(p.conditionId).toLowerCase(),
          minSamples: Number(p.minSamples),
          resolver: String(p.resolver).toLowerCase(),
          contract: address.toLowerCase(),
          chainPotId: id.toString(),
          knock: state === 4 && Boolean(p.knock),
        }),
      ],
    );
  }
  return { state, data };
}

/* ------------------------------------------------------------------ sampler work */

type ReqRow = { id: string; kind: string; pot_id: string | null; payload: Record<string, unknown> | string; status: string; digest: string | null; created_at: string };
const payloadOf = (r: ReqRow) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) as Record<string, unknown>;

export type MeasureTask = {
  requestId: string;
  potId: string;
  kind: number;
  nonce: string;
  windowStart: number;
  windowEnd: number;
  instrument: string;
  params: TriggerParams;
  conditionId: Hex;
  eventTicker: string;
  contractTicker: string;
  /** The pot's resolver; when it is the MedianResolver the sampler signs its own average on-chain-checkable. */
  resolver: string | null;
  /** The pot contract and its own pot id (v2 pots differ from the database id), its EIP-712 name and MedianResolver. */
  contract?: Address;
  chainPotId?: string;
  name?: "HonorCatPots" | "HonorCatRopes";
  median?: Address | null;
};
/** A live short rope whose posts the samplers watch for a knock-out. */
export type KnockWatch = { potId: string; lower: number; upper: number; window: number; armedAt: number; expiry: number; instrument: string; params: TriggerParams; nonce: string };
export type CosignTask = { requestId: string; kind: "window" | "depth" | "outcome"; digest: Hex; payload: Record<string, unknown> };
export type LevelWatch = { potId: string; side: 0 | 1; net: number; bowl: number; setAt: number; window: number; instrument: string; params: TriggerParams; nonce: string };

/** What a sampler should do now: windows to measure, proposals to co-sign, levels to watch. */
type LiveRow = { pot_id: string; data: Record<string, unknown> | string; condition_id: string };
const liveCache = new WeakMap<Db, { at: number; rows: Promise<LiveRow[]> }>();
/**
 * Live pots with only the fields the samplers need (the whole projection is several KB per pot).
 * Every sampler asks every few seconds and the answer is the same for all of them, so it is shared
 * for 5 seconds per instance: a new pot is watched at most 5 seconds later.
 */
function liveForSamplers(db: Db): Promise<LiveRow[]> {
  const hit = liveCache.get(db);
  if (hit && Date.now() - hit.at < 5_000) return hit.rows;
  const rows = db.query<LiveRow>(
    `SELECT pot_id::text AS pot_id, condition_id,
            jsonb_build_object('levels', data->'levels', 'window', data->'window', 'nonce', data->'nonce', 'expiry', data->'expiry',
                               'lower', data->'lower', 'upper', data->'upper', 'armedAt', data->'armedAt') AS data
       FROM pots WHERE state = 3`,
  );
  liveCache.set(db, { at: Date.now(), rows });
  rows.catch(() => liveCache.delete(db));
  return rows;
}

export async function potsWork(db: Db, signer: Address) {
  const s = signer.toLowerCase();
  const now = Math.floor(Date.now() / 1000);
  if (signerSet().samplers.some((x) => x.toLowerCase() === s)) {
    await db.query(
      `INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
       WHERE relay_state.value::bigint < $3`,
      [`sampler_seen:${s}`, String(now), now - 20],
    );
  }
  const measuring = await db.query<ReqRow>(
    `SELECT r.* FROM att_requests r WHERE r.kind = 'window' AND r.status = 'measuring'
       AND NOT EXISTS (SELECT 1 FROM att_averages a WHERE a.request_id = r.id AND a.signer = $1)
       AND r.created_at > now() - interval '30 minutes'`,
    [s],
  );
  const measure: MeasureTask[] = [];
  for (const r of measuring) {
    const p = payloadOf(r);
    const m = await marketOf(db, String(p.conditionId));
    if (!m) continue;
    const ct = contractOf(String(r.pot_id));
    measure.push({
      contract: ct.address,
      chainPotId: ct.chainPotId.toString(),
      name: ct.name,
      median: ct.median,
      requestId: r.id,
      potId: String(r.pot_id),
      kind: Number(p.kind),
      nonce: String(p.nonce),
      windowStart: Number(p.windowStart),
      windowEnd: Number(p.windowEnd),
      instrument: m.instrument,
      params: m.params,
      conditionId: m.conditionId,
      eventTicker: m.eventTicker,
      contractTicker: m.contractTicker,
      resolver: p.resolver ? String(p.resolver) : null,
    });
  }
  const proposed = await db.query<ReqRow>(
    `SELECT r.* FROM att_requests r WHERE r.status = 'proposed'
       AND NOT EXISTS (SELECT 1 FROM att_sigs g WHERE g.request_id = r.id AND g.signer = $1)
       AND r.created_at > now() - interval '30 minutes'`,
    [s],
  );
  const cosign: CosignTask[] = proposed.map((r) => ({ requestId: r.id, kind: r.kind as CosignTask["kind"], digest: r.digest as Hex, payload: payloadOf(r) }));
  const live = await liveForSamplers(db);
  const levels: LevelWatch[] = [];
  for (const row of live) {
    const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, unknown>;
    const lv = (d.levels as ({ net: number; bowl: number; setAt: string } | null)[] | undefined) ?? [];
    const m = await marketOf(db, row.condition_id);
    if (!m) continue;
    lv.forEach((l, side) => {
      if (l && (l.net > 0 || l.bowl > 0))
        levels.push({ potId: row.pot_id, side: side as 0 | 1, net: l.net, bowl: l.bowl, setAt: Number(l.setAt), window: Number(d.window), instrument: m.instrument, params: m.params, nonce: String(d.nonce) });
    });
  }
  // Short ropes: every live rope's posts are watched for a knock-out.
  const knocks: KnockWatch[] = [];
  for (const row of live) {
    if (!isRopeDbId(row.pot_id)) continue;
    const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, string>;
    if (Number(d.expiry) === 0) continue;
    const m = await marketOf(db, row.condition_id);
    if (!m) continue;
    knocks.push({ potId: row.pot_id, lower: Number(d.lower), upper: Number(d.upper), window: Number(d.window), armedAt: Number(d.armedAt), expiry: Number(d.expiry), instrument: m.instrument, params: m.params, nonce: String(d.nonce) });
  }
  return { now, measure, cosign, levels, knocks, pots: (getConfig().pots?.address ?? getConfig().ropes?.address)!, chainId: getConfig().chainId, median: getConfig().median };
}

/* ------------------------------------------------------------------ averages and proposals */

const ppmOf = (averageMicro: bigint, priceDecimals: number) => averageMicro / 10n ** BigInt(priceDecimals);

/** A sampler's own signed window average. Verified fully before it counts. */
export async function submitAverage(
  db: Db,
  requestId: string,
  input: { signer: Address; record: unknown; signature: Hex; average?: { priceYes: number; valid: boolean; sampleCount: number; signature: Hex } },
) {
  const set = signerSet();
  const signer = getAddress(input.signer);
  if (!set.samplers.some((x) => x.toLowerCase() === signer.toLowerCase())) throw Object.assign(new Error("not a sampler of the signer set"), { status: 403 });
  const req = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1", [requestId]))[0];
  if (!req || req.kind !== "window") throw Object.assign(new Error("unknown window"), { status: 404 });
  if (req.status !== "measuring") return { accepted: false, reason: `request is ${req.status}` };
  const p = payloadOf(req);
  const record = recordFromJson(input.record as never);
  const m = await marketOf(db, String(p.conditionId));
  if (!m) throw Object.assign(new Error("market of this pot is unknown"), { status: 409 });
  if (record.signer.toLowerCase() !== signer.toLowerCase()) throw Object.assign(new Error("record signer mismatch"), { status: 400 });
  const ct = contractOf(String(req.pot_id));
  if (record.vault.toLowerCase() !== ct.address.toLowerCase() || record.potId !== ct.chainPotId) throw Object.assign(new Error("record is for another pot"), { status: 400 });
  if (record.conditionId.toLowerCase() !== String(p.conditionId)) throw Object.assign(new Error("record rule does not match the pot"), { status: 400 });
  if (record.windowStart !== Number(p.windowStart) * 1000 || record.windowEnd !== Number(p.windowEnd) * 1000) throw Object.assign(new Error("record window does not match"), { status: 400 });
  const decision = verifyRecord(record); // throws on any inconsistency
  const hash = evidenceHash(record);
  if (!(await verifyMessage({ address: signer, message: { raw: hash }, signature: input.signature }))) throw Object.assign(new Error("bad signature"), { status: 401 });
  let valid = decision.code === 0 || decision.code === 1; // enough valid samples, fresh at the end
  const ppm = ppmOf(record.averageMicro, record.params.priceDecimals);
  let avgSig: Hex | null = null;
  const median = ct.median;
  if (median && String(p.resolver ?? "") === median.toLowerCase()) {
    // The MedianResolver checks the sampler's own signed average on-chain: it must match its record.
    const v = input.average;
    if (!v) throw Object.assign(new Error("this pot needs the sampler's signed average"), { status: 400 });
    if (BigInt(v.priceYes) !== ppm || v.sampleCount !== record.validCount || (v.valid && !valid)) throw Object.assign(new Error("signed average does not match the record"), { status: 400 });
    const ok = await verifyTypedData({ address: signer, ...averageTyped(median, { potId: ct.chainPotId.toString(), kind: Number(p.kind), nonce: String(p.nonce), windowStart: Number(p.windowStart), windowEnd: Number(p.windowEnd) }, { priceYes: v.priceYes, valid: v.valid, sampleCount: v.sampleCount, evidenceHash: hash }, { chainId: getConfig().chainId, pots: ct.address }), signature: v.signature });
    if (!ok) throw Object.assign(new Error("bad average signature"), { status: 401 });
    valid = v.valid; // the sampler's own call, which includes Gemini's market status
    avgSig = v.signature;
  }
  await db.query(
    `INSERT INTO att_averages (request_id, signer, price_ppm, valid, sample_count, evidence_hash, record, signature, avg_signature)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
    [requestId, signer.toLowerCase(), ppm.toString(), valid, record.validCount, hash, JSON.stringify(input.record), input.signature, avgSig],
  );
  await maybePropose(db, requestId);
  return { accepted: true, ppm: ppm.toString(), valid };
}

/** How long to wait for the third sampler when the first two disagree (seconds after the window). */
export const THIRD_WAIT_S = 6;

/**
 * Whether the reported averages already settle the price: at least `threshold` of them, all with the
 * same verdict on validity and, when valid, within half a point of each other. The contract's median
 * rule gives the same price with or without a third that agrees, so there is no reason to wait.
 */
export function averagesAgree(rows: { price_ppm: string; valid: boolean }[], threshold: number) {
  if (rows.length < threshold) return false;
  if (!rows.every((r) => r.valid === rows[0]!.valid)) return false;
  if (!rows[0]!.valid) return true;
  const ps = rows.map((r) => BigInt(r.price_ppm));
  const max = ps.reduce((a, b) => (b > a ? b : a));
  const min = ps.reduce((a, b) => (b < a ? b : a));
  return max - min <= AGREE_PPM;
}

/**
 * Proposes once every sampler has reported; or as soon as two agree (within half a point); or, when
 * they disagree, once the third had THIRD_WAIT_S seconds after the window to report.
 */
export async function maybePropose(db: Db, requestId: string, force = false) {
  const req = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1", [requestId]))[0];
  if (!req || req.status !== "measuring") return null;
  const p = payloadOf(req);
  const rows = await db.query<{ signer: string; price_ppm: string; valid: boolean; sample_count: number; evidence_hash: string }>(
    "SELECT signer, price_ppm::text AS price_ppm, valid, sample_count, evidence_hash FROM att_averages WHERE request_id = $1",
    [requestId],
  );
  const set = signerSet();
  const ended = Math.floor(Date.now() / 1000) > Number(p.windowEnd) + THIRD_WAIT_S;
  if (!force && rows.length < set.samplers.length && !(rows.length >= set.threshold && (ended || averagesAgree(rows, set.threshold)))) return null;
  if (rows.length < set.threshold && !force) return null;
  const avgs: Avg[] = rows.map((r) => ({ signer: getAddress(r.signer), ppm: BigInt(r.price_ppm), valid: r.valid, sampleCount: r.sample_count, evidenceHash: r.evidence_hash as Hex }));
  const median = contractOf(String(req.pot_id)).median;
  if (median && String(p.resolver ?? "") === median.toLowerCase()) return medianReady(db, req, p, avgs, set.samplers.length);
  let prop = propose(avgs);
  // The market must have been open (not halted, not under review) for the window to count.
  if (prop.valid) {
    const m = await marketOf(db, String(p.conditionId));
    const st = m ? await fetchMarketState(m.eventTicker, m.contractTicker) : null;
    const blocked = marketGate(st);
    if (blocked) prop = { ...prop, valid: false, ppm: 0n, reason: blocked };
  }
  const att: WindowAtt = {
    potId: chainPotId(String(req.pot_id)).toString(),
    kind: Number(p.kind),
    nonce: String(p.nonce),
    windowStart: String(p.windowStart),
    windowEnd: String(p.windowEnd),
    sampleCount: prop.used.length ? Math.min(...prop.used.map((a) => a.sampleCount)) : 0,
    priceYes: Number(prop.ppm),
    valid: prop.valid,
    evidenceHash: avgs.length ? rootOf(prop.used.length ? prop.used : avgs) : (`0x${"0".repeat(64)}` as Hex),
  };
  const digest = windowDigest(att, atOf(String(req.pot_id)));
  await db.query("UPDATE att_requests SET status = 'proposed', payload = $2, digest = $3, updated_at = now() WHERE id = $1 AND status = 'measuring'", [
    requestId,
    JSON.stringify({ ...p, attestation: att, reason: prop.reason, averages: avgs.map((a) => ({ ...a, ppm: a.ppm.toString() })) }),
    digest,
  ]);
  return att;
}

/** A sampler's co-signature (raw ECDSA over the EIP-712 digest). With M of them the relay submits. */
export async function submitCosig(db: Db, requestId: string, input: { signer: Address; signature: Hex }) {
  const set = signerSet();
  const req = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1", [requestId]))[0];
  if (!req || req.status !== "proposed" || !req.digest) return { accepted: false };
  const who = await recoverAddress({ hash: req.digest as Hex, signature: input.signature });
  if (who.toLowerCase() !== input.signer.toLowerCase() || !set.samplers.some((x) => x.toLowerCase() === who.toLowerCase())) {
    throw Object.assign(new Error("signature is not from a sampler of the set"), { status: 401 });
  }
  await db.query("INSERT INTO att_sigs (request_id, signer, signature) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [requestId, who.toLowerCase(), input.signature]);
  const n = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM att_sigs WHERE request_id = $1", [requestId]);
  if (Number(n[0]!.n) >= set.threshold) {
    await db.query("UPDATE att_requests SET status = 'ready', updated_at = now() WHERE id = $1 AND status = 'proposed'", [requestId]);
    // Depth and quote attestations are handed to whoever asked; nothing is sent on-chain for them.
    const isQuote = req.kind === "window" && Number(payloadOf(req).kind) === KIND.quote;
    if (req.kind !== "depth" && !isQuote) await submitReady(db, requestId);
  }
  return { accepted: true };
}

/** The M signatures in ascending signer order, concatenated (the MultisigResolver format). */
export async function signaturesOf(db: Db, requestId: string): Promise<Hex | null> {
  const set = signerSet();
  const req = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1", [requestId]))[0];
  if (req && req.kind === "window" && payloadOf(req).median === true) return medianSignature(db, requestId, payloadOf(req).attestation as WindowAtt);
  const rows = await db.query<{ signer: string; signature: string }>("SELECT signer, signature FROM att_sigs WHERE request_id = $1", [requestId]);
  if (rows.length < set.threshold) return null;
  const sorted = rows.sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1)).slice(0, set.threshold);
  return concat(sorted.map((r) => r.signature as Hex));
}

/** encodeFunctionData for a function chosen at run time on either pot contract's ABI. */
const encodeCall = (abi: readonly unknown[], functionName: string, args: readonly unknown[]): Hex =>
  (encodeFunctionData as unknown as (x: { abi: readonly unknown[]; functionName: string; args: readonly unknown[] }) => Hex)({ abi, functionName, args });

const toWindowArg = (a: WindowAtt) => ({
  potId: BigInt(a.potId),
  kind: a.kind,
  nonce: BigInt(a.nonce),
  windowStart: BigInt(a.windowStart),
  windowEnd: BigInt(a.windowEnd),
  sampleCount: a.sampleCount,
  priceYes: a.priceYes,
  valid: a.valid,
  evidenceHash: a.evidenceHash,
});

/** Submits a ready window or outcome attestation (with a Memo explaining it). Anyone could do this. */
export async function submitReady(db: Db, requestId: string) {
  const req = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1", [requestId]))[0];
  if (!req || req.status !== "ready") return null;
  if (req.kind === "window" && Number(payloadOf(req).kind) === KIND.quote) return null; // never on-chain
  const sigs = await signaturesOf(db, requestId);
  if (!sigs) return null;
  const p = payloadOf(req);
  if (req.kind === "window" && Number(p.kind) === KIND_KNOCK) {
    // The contract only takes a knock-out with an agreed price at or beyond a post: anything else
    // would revert, so it is recorded as "no knock-out" instead of being sent.
    const a = p.attestation as WindowAtt;
    const row = (await db.query<PotRow>("SELECT pot_id::text AS pot_id, state, data, condition_id FROM pots WHERE pot_id = $1", [String(req.pot_id)]))[0];
    const d = row ? ((typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, string>) : null;
    const lower = Number(d?.lower ?? 0);
    const upper = Number(d?.upper ?? 1_000_000);
    const at = a.valid && ((lower > 0 && a.priceYes <= lower) || (upper < 1_000_000 && a.priceYes >= upper));
    if (!at) {
      await db.query("UPDATE att_requests SET status = 'failed', error = $2, updated_at = now() WHERE id = $1", [requestId, a.valid ? "the agreed price is not at a post" : "no agreed price"]);
      return null;
    }
  }
  const ct = contractOf(String(req.pot_id));
  const address = ct.address;
  const abi: readonly unknown[] = ct.v2 ? ropesAbi : potsAbi;
  let data: Hex;
  let why: string;
  if (req.kind === "window") {
    const a = p.attestation as WindowAtt;
    const fn = a.kind === KIND.join ? "resolveJoin" : a.kind === KIND.exit ? "resolveExit" : a.kind === KIND_KNOCK ? "triggerKnockOut" : a.kind === KIND_EXPIRY ? "resolveExpiry" : "triggerLevel";
    data = encodeCall(abi, fn, [toWindowArg(a), sigs]);
    const what =
      a.kind === KIND.join ? "entry price" : a.kind === KIND.exit ? (p.knock ? "knock-out price" : "exit price") : a.kind === KIND_KNOCK ? "price at a post" : a.kind === KIND_EXPIRY ? "expiry price" : "level held";
    why = a.valid ? `${what} ${(a.priceYes / 10_000).toFixed(2)}% (YES), window ${a.windowStart}-${a.windowEnd}, ${String(p.reason)}` : `no ${what}: ${String(p.reason)}`;
  } else if (req.kind === "outcome") {
    const o = p.attestation as OutcomeAtt;
    data = encodeCall(abi, "settle", [{ potId: BigInt(o.potId), conditionId: o.conditionId, outcome: o.outcome, evidenceHash: o.evidenceHash }, sigs]);
    why = `Gemini settled ${o.outcome === 1 ? "YES" : o.outcome === 0 ? "NO" : "void"}`;
  } else return null;
  const ref = `pot-${String(req.pot_id)}`;
  // Arc's block time trails the wall clock by a few seconds: the contract refuses a window that has
  // not ended by block.timestamp (TooEarly), so wait for the chain's clock first (at most ~20 s).
  if (req.kind === "window") {
    const end = Number((p.attestation as WindowAtt).windowEnd);
    for (let i = 0; i < 3; i++) {
      const b = await publicClient().getBlock();
      const gap = end - Number(b.timestamp);
      if (gap <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(20, gap) * 1000 + 300));
    }
  }
  const res = await sendRelayCalls(db, req.kind === "outcome" ? "pot_settle" : "pot_attest", [
    { ...memoCall(address, data, ref, { v: 1, t: "pot", ref, pot: String(req.pot_id), why }), potIds: [], label: `${req.kind} ${requestId}` },
  ]);
  if (res.ok) {
    await db.query("UPDATE att_requests SET status = 'submitted', tx = $2, error = NULL, updated_at = now() WHERE id = $1", [requestId, res.tx]);
    await recordMemo(db, requestId, res.tx).catch(() => {});
    if (req.pot_id) await syncPot(db, BigInt(String(req.pot_id))).catch(() => {});
    return res.tx;
  }
  // TooEarly (0x085de625) is a timing miss, not a bad attestation: leave it ready for the next pass.
  // So is an RPC error that never reached the chain (rate or size limit, timeout): housekeeping
  // sends it again for 15 minutes (see TRANSIENT).
  const retry = res.error.includes("085de625") || res.error.includes("TooEarly");
  await db.query("UPDATE att_requests SET status = $3, error = $2, updated_at = now() WHERE id = $1", [requestId, res.error.slice(0, 500), retry ? "ready" : "failed"]);
  return null;
}

/* ------------------------------------------------------------------ depth (cap) at creation */

/** Contracts within 5 cents of the mid on the thinner side, in hundredths of a contract. */
export async function measureContracts5c(instrument: string): Promise<bigint | null> {
  const raw = await readBook(instrument);
  if (!raw) return null;
  const s = bookStats(raw, Date.now());
  if (s.bid === null || s.ask === null) return 0n;
  return BigInt(Math.floor(Math.min(s.bidDepth, s.askDepth) * 100));
}

/** Opens a depth request, signed at once by `own` (the app's sampler); others co-sign within seconds. */
export async function requestDepth(db: Db, input: { conditionId: Hex; account: Address; instrument: string; closeTime: number }, own: LocalAccount | null) {
  const c5 = await measureContracts5c(input.instrument);
  if (c5 === null) throw Object.assign(new Error("Gemini did not return this market's order book"), { status: 502 });
  const d: DepthAtt = { conditionId: input.conditionId, account: getAddress(input.account), contracts5c: c5.toString(), closeTime: String(input.closeTime), validUntil: String(Math.floor(Date.now() / 1000) + 120) };
  const id = `d:${randomUUID()}`;
  const digest = depthDigest(d);
  await db.query("INSERT INTO att_requests (id, kind, payload, status, digest) VALUES ($1,'depth',$2,'proposed',$3)", [id, JSON.stringify({ attestation: d, instrument: input.instrument }), digest]);
  if (own) await submitCosig(db, id, { signer: own.address, signature: await own.sign!({ hash: digest }) });
  return { id, depth: d };
}

/** v2 depth: contracts within 5¢ on the thinner side, the spread (ppm) and whether the market is crypto. */
export async function requestDepthV2(
  db: Db,
  input: { conditionId: Hex; account: Address; instrument: string; closeTime: number; crypto: boolean },
  own: LocalAccount | null,
) {
  const raw = await readBook(input.instrument);
  if (!raw) throw Object.assign(new Error("Gemini did not return this market's order book"), { status: 502 });
  const st = bookStats(raw, Date.now());
  const c5 = st.bid === null || st.ask === null ? 0n : BigInt(Math.floor(Math.min(st.bidDepth, st.askDepth) * 100));
  const spread = st.bid === null || st.ask === null ? 1_000_000 : Math.round((st.ask - st.bid) * 1e6);
  const d: DepthAtt = {
    conditionId: input.conditionId,
    account: getAddress(input.account),
    contracts5c: c5.toString(),
    spread,
    crypto: input.crypto,
    closeTime: String(input.closeTime),
    validUntil: String(Math.floor(Date.now() / 1000) + 120),
  };
  const r = getConfig().ropes;
  if (!r) throw Object.assign(new Error("HonorCat v2 is not deployed"), { status: 409 });
  const at: At = { chainId: getConfig().chainId, pots: r.address, name: "HonorCatRopes" };
  const id = `d:${randomUUID()}`;
  const digest = depthDigest(d, at);
  await db.query("INSERT INTO att_requests (id, kind, payload, status, digest) VALUES ($1,'depth',$2,'proposed',$3)", [
    id,
    JSON.stringify({ attestation: d, instrument: input.instrument, contract: r.address.toLowerCase(), name: at.name }),
    digest,
  ]);
  if (own) await submitCosig(db, id, { signer: own.address, signature: await own.sign!({ hash: digest }) });
  return { id, depth: d };
}

export async function depthResult(db: Db, id: string) {
  const r = (await db.query<ReqRow>("SELECT * FROM att_requests WHERE id = $1 AND kind = 'depth'", [id]))[0];
  if (!r) return null;
  const sigs = await signaturesOf(db, id);
  return { depth: payloadOf(r).attestation as DepthAtt, signatures: sigs };
}

/* ------------------------------------------------------------------ housekeeping and settlement */

type PotRow = { pot_id: string; state: number; data: Record<string, unknown> | string; condition_id: string };

/**
 * One pass over running pots: propose stalled windows, open settlement requests after the close,
 * and send the permissionless clean-ups (abandon a window that timed out, expire after the
 * deadline, cancel an unjoined offer after the close).
 */
/** RPC errors that never reached the chain: sent again (POSIX regex, case-insensitive). */
const TRANSIENT = "exceeds defined limit|rate limit|too many requests|429|timed? ?out|fetch failed|ECONNRESET|socket hang up|HTTP request failed";

export async function potsHousekeeping(db: Db, own: LocalAccount | null) {
  if (!getConfig().pots) return { checked: 0 };
  const now = Math.floor(Date.now() / 1000);
  // Windows with two averages whose wait for the third is over.
  for (const r of await db.query<{ id: string }>("SELECT id FROM att_requests WHERE kind = 'window' AND status = 'measuring'")) await maybePropose(db, r.id);
  // Ready but not yet submitted (e.g. a failed send).
  await db.query(
    `UPDATE att_requests SET status = 'ready' WHERE status = 'failed' AND kind <> 'depth' AND (error LIKE '%085de625%' OR error ~* $1)
       AND created_at > now() - interval '15 minutes' AND updated_at < now() - interval '20 seconds'`,
    [TRANSIENT],
  );
  for (const r of await db.query<{ id: string }>("SELECT id FROM att_requests WHERE status = 'ready' AND kind <> 'depth' AND updated_at < now() - interval '10 seconds'")) await submitReady(db, r.id);

  // Memos of earlier payouts, read back from the chain (a few per pass).
  for (const r of await db.query<{ id: string; tx: string }>("SELECT id, tx FROM att_requests WHERE status = 'submitted' AND tx IS NOT NULL AND NOT (payload ? 'memo') ORDER BY updated_at DESC LIMIT 5"))
    await recordMemo(db, r.id, r.tx as Hex).catch(() => {});

  const rows = await db.query<PotRow>("SELECT pot_id::text AS pot_id, state, data, condition_id FROM pots WHERE state BETWEEN 1 AND 4");
  const calls: { fn: "abandonJoin" | "abandonExit" | "expire" | "cancel" | "skipExpiryWindow"; pot: bigint }[] = [];
  for (const row of rows) {
    const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, string>;
    const pot = BigInt(row.pot_id);
    if (isRopeDbId(pot) && !deploymentOf(pot)) continue;
    const close = Number(d.closeTime);
    const deadline = Number(d.deadline);
    const expiry = Number(d.expiry ?? 0);
    const end = expiry > 0 ? expiry : close; // a short rope ends at its expiry
    const windowOver = Number(d.requestTime) + DELAY + Number(d.window) + 600;
    if (now >= deadline) calls.push({ fn: "expire", pot });
    else if (row.state === 1 && now >= end) calls.push({ fn: "cancel", pot });
    else if (row.state === 2 && now > windowOver) calls.push({ fn: "abandonJoin", pot });
    else if (row.state === 4 && now > windowOver) calls.push({ fn: "abandonExit", pot });
    else if (row.state === 3 && expiry > 0 && Number(d.expiryTry) < EXPIRY_TRIES) {
      // Short rope: open the expiry window fixed by the contract just before it starts, so every
      // sampler measures it; skip it if no attestation came in time (the next fixed one applies).
      const attempt = Number(d.expiryTry);
      const start = expiryWindowStart(expiry, Number(d.window), attempt);
      if (now >= start - 120) await openExpiryWindow(db, row, d, attempt, start);
      if (now > start + Number(d.window) + ATTEST_TIMEOUT_S + 5) calls.push({ fn: "skipExpiryWindow", pot });
    }
    if ((row.state === 3 || row.state === 4) && now >= close) await openOutcome(db, pot, row.condition_id, own);
  }
  for (const c of calls) {
    const ct = contractOf(c.pot);
    const data = encodeCall(ct.v2 ? ropesAbi : potsAbi, c.fn, [ct.chainPotId]);
    const ref = `pot-${c.pot}`;
    const res = await sendRelayCalls(db, "pot_house", [{ ...memoCall(ct.address, data, ref, { v: 1, t: "pot", ref, pot: c.pot.toString(), why: c.fn }), potIds: [], label: `${c.fn} ${c.pot}` }]);
    if (res.ok) await syncPot(db, c.pot).catch(() => {});
  }
  return { checked: rows.length, calls: calls.length };
}

/** After the close: if Gemini has settled the contract, propose the outcome; the app's sampler signs. */
async function openOutcome(db: Db, pot: bigint, conditionId: string, own: LocalAccount | null) {
  const id = `o:${pot}`;
  if ((await db.query("SELECT 1 FROM att_requests WHERE id = $1", [id])).length) return;
  const m = await marketOf(db, conditionId);
  if (!m) return;
  const st = await fetchMarketState(m.eventTicker, m.contractTicker);
  if (!st) return;
  let outcome: number | null = null;
  if (st.resolutionSide === "yes") outcome = 1;
  else if (st.resolutionSide === "no") outcome = 0;
  else if (st.status === "invalid") outcome = 2;
  if (outcome === null) return;
  const o: OutcomeAtt = { potId: chainPotId(pot).toString(), conditionId: conditionId as Hex, outcome, evidenceHash: `0x${"0".repeat(64)}` as Hex };
  const at = atOf(pot);
  const digest = outcomeDigest(o, at);
  await db.query("INSERT INTO att_requests (id, kind, pot_id, payload, status, digest) VALUES ($1,'outcome',$2,$3,'proposed',$4) ON CONFLICT DO NOTHING", [
    id,
    pot.toString(),
    JSON.stringify({ attestation: o, eventTicker: m.eventTicker, contractTicker: m.contractTicker, status: st.status, resolutionSide: st.resolutionSide, contract: at.pots.toLowerCase(), name: at.name }),
    digest,
  ]);
  if (own) await submitCosig(db, id, { signer: own.address, signature: await own.sign!({ hash: digest }) });
}

/* ------------------------------------------------------------------ nets and bowls */

/**
 * A sampler saw a side's own price hold beyond its net or bowl over [end − W, end]. The relay opens
 * one request for exactly that window so every sampler measures the same seconds.
 */
export async function openLevelWindow(db: Db, input: { potId: string; side: 0 | 1; kind: number; windowEnd: number }) {
  const row = (await db.query<PotRow>("SELECT pot_id::text AS pot_id, state, data, condition_id FROM pots WHERE pot_id = $1", [input.potId]))[0];
  if (!row || row.state !== 3) return null;
  const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, unknown>;
  const kind = input.kind;
  if (kind < 2 || kind > 5 || (kind - 2) % 2 !== input.side) throw Object.assign(new Error("bad level kind"), { status: 400 });
  const id = `w:${input.potId}:${d.nonce}:${kind}`;
  await db.query(`INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`, [
    id,
    input.potId,
    JSON.stringify({ kind, nonce: String(d.nonce), windowStart: input.windowEnd - Number(d.window), windowEnd: input.windowEnd, conditionId: row.condition_id, minSamples: Number(d.minSamples), side: input.side, resolver: String(d.resolver).toLowerCase(), contract: contractOf(input.potId).address.toLowerCase() }),
  ]);
  return id;
}

/**
 * A sampler saw a short rope's price hold at or beyond a post over [end − W, end]. The relay opens one
 * request for exactly that window (at most one open per pot) so every sampler measures the same
 * seconds; if the median is at a post the knock-out is submitted, otherwise nothing happens.
 */
export async function openKnockWindow(db: Db, input: { potId: string; windowEnd: number }) {
  if (!isRopeDbId(input.potId)) throw Object.assign(new Error("only short ropes have posts"), { status: 400 });
  const row = (await db.query<PotRow>("SELECT pot_id::text AS pot_id, state, data, condition_id FROM pots WHERE pot_id = $1", [input.potId]))[0];
  if (!row || row.state !== 3) return null;
  const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, string>;
  const window = Number(d.window);
  if (Number(d.expiry) === 0 || !knockWindowOk({ windowEnd: input.windowEnd, window, armedAt: Number(d.armedAt), expiry: Number(d.expiry) })) return null;
  const open = await db.query<{ id: string }>(
    "SELECT id FROM att_requests WHERE pot_id = $1 AND id LIKE 'k:%' AND status IN ('measuring','proposed','ready') AND created_at > now() - interval '10 minutes'",
    [input.potId],
  );
  if (open[0]) return open[0].id;
  const id = `k:${input.potId}:${d.nonce}:${input.windowEnd}`;
  const ct = contractOf(input.potId);
  await db.query(`INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`, [
    id,
    input.potId,
    JSON.stringify({ kind: KIND_KNOCK, nonce: String(d.nonce), windowStart: input.windowEnd - window, windowEnd: input.windowEnd, conditionId: row.condition_id, minSamples: Number(d.minSamples), resolver: String(d.resolver).toLowerCase(), contract: ct.address.toLowerCase(), chainPotId: ct.chainPotId.toString() }),
  ]);
  return id;
}

/** Opens expiry window `attempt` of a short rope: fixed by the contract (expiry + 1 s, then retries). */
async function openExpiryWindow(db: Db, row: PotRow, d: Record<string, string>, attempt: number, start: number) {
  const ct = contractOf(row.pot_id);
  await db.query(`INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`, [
    `x:${row.pot_id}:${attempt}`,
    row.pot_id,
    JSON.stringify({ kind: KIND_EXPIRY, attempt, nonce: String(d.nonce), windowStart: start, windowEnd: start + Number(d.window), conditionId: row.condition_id, minSamples: Number(d.minSamples), resolver: String(d.resolver).toLowerCase(), contract: ct.address.toLowerCase(), chainPotId: ct.chainPotId.toString() }),
  ]);
}

/* ------------------------------------------------------------------ indexing */

/**
 * Reads new HonorCatPots logs (in 5,000-block chunks; Arc caps eth_getLogs at 10,000) and
 * refreshes every pot they touch. Covers transactions the relay did not send (wallet users).
 */
export const POLLER_LAG_BLOCKS = 10n; // Arc is final in under a second: a few blocks of margin is plenty
// The database was rebuilt from the chain on 2026-11-16 (every older event is marked as found by
// the poller), and the stream was resumed at about this block: count Streams' share from here.
export const STREAMS_POTS_SINCE_BLOCK = 72_600_235n;

export async function indexPots(db: Db, opts: { deadlineMs?: number } = {}) {
  const cfg = getConfig();
  if (!cfg.pots) return null;
  const c = publicClient();
  const started = Date.now();
  const cursor = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = 'pots_cursor_v2'");
  let from = cursor[0] ? BigInt(cursor[0].value) + 1n : cfg.pots.deployBlock;
  // Streams is the primary path; the poller trails the chain head by about a minute and only
  // fills what Streams did not deliver (an outage, a paused stream).
  const head = (await c.getBlockNumber()) - POLLER_LAG_BLOCKS;
  const touched = new Set<string>();
  while (from <= head && Date.now() - started < (opts.deadlineMs ?? 15_000)) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await c.getLogs({ address: cfg.pots.address, fromBlock: from, toBlock: to });
    const times = new Map<bigint, number>();
    for (const l of parseEventLogs({ abi: potsAbi, logs })) {
      const id = (l.args as { potId?: bigint; tokenId?: bigint }).potId ?? ((l.args as { tokenId?: bigint }).tokenId !== undefined ? (l.args as { tokenId: bigint }).tokenId / 2n : undefined);
      if (typeof id === "bigint") touched.add(id.toString());
      if (!times.has(l.blockNumber)) times.set(l.blockNumber, Number((await c.getBlock({ blockNumber: l.blockNumber })).timestamp));
      await recordPotEvent(db, l, id ?? null, times.get(l.blockNumber)!, "rpc");
    }
    await db.query(
      "INSERT INTO relay_state (key, value) VALUES ('pots_cursor_v2', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [to.toString()],
    );
    from = to + 1n;
  }
  for (const dep of cfg.ropesAll) if (Date.now() - started < (opts.deadlineMs ?? 15_000)) await indexRopes(db, dep, head, touched, started, opts.deadlineMs ?? 15_000);
  for (const id of touched) await syncPot(db, BigInt(id));
  return { touched: touched.size, to: (from - 1n).toString() };
}

/** The same for each HonorCatRopes (v2) deployment, with its own cursor; pot ids go into its id range. */
async function indexRopes(db: Db, r: { address: Address; deployBlock: bigint; idBase: bigint }, head: bigint, touched: Set<string>, started: number, deadlineMs: number) {
  const c = publicClient();
  // v2.0 (id base 1e9) kept the original cursor key; later deployments have their own
  const key = r.idBase === 1_000_000_000n ? "ropes_cursor" : `ropes_cursor:${r.idBase}`;
  const cursor = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [key]);
  let from = cursor[0] ? BigInt(cursor[0].value) + 1n : r.deployBlock;
  while (from <= head && Date.now() - started < deadlineMs) {
    const to = from + 4_999n > head ? head : from + 4_999n;
    const logs = await c.getLogs({ address: r.address, fromBlock: from, toBlock: to });
    const times = new Map<bigint, number>();
    for (const l of parseEventLogs({ abi: ropesAbi, logs })) {
      const id = ropeIdOfLog(l.args, r.idBase);
      if (id) touched.add(id);
      if (!times.has(l.blockNumber)) times.set(l.blockNumber, Number((await c.getBlock({ blockNumber: l.blockNumber })).timestamp));
      await recordPotEvent(db, ropeLog(l, r.idBase), id ? BigInt(id) : null, times.get(l.blockNumber)!, "rpc");
    }
    await db.query("INSERT INTO relay_state (key, value) VALUES ($2, $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value", [to.toString(), key]);
    from = to + 1n;
  }
}

/** The database pot id a v2 event belongs to (from potId or tokenId). */
function ropeIdOfLog(args: unknown, base: bigint): string | null {
  const a = args as { potId?: bigint; tokenId?: bigint; fromPot?: bigint };
  if (typeof a.potId === "bigint") return ropeDbId(a.potId, base);
  if (typeof a.tokenId === "bigint") return ropeDbId(a.tokenId / 2n, base);
  return null;
}

/** A v2 event with its pot and token ids moved into the v2 range, so pages and records read one id space. */
function ropeLog<T extends { args: unknown }>(l: T, base: bigint): T {
  const a = { ...(l.args as Record<string, unknown>) };
  if (typeof a.potId === "bigint") a.potId = BigInt(ropeDbId(a.potId as bigint, base));
  if (typeof a.fromPot === "bigint") a.fromPot = BigInt(ropeDbId(a.fromPot as bigint, base));
  if (typeof a.tokenId === "bigint") a.tokenId = (a.tokenId as bigint) + 2n * base;
  return { ...l, args: a };
}

/* ------------------------------------------------------------------ preparing a pot */

export const POT_WINDOW_S = 30;
export const POT_MIN_SAMPLES = 10;
export const CAP_PER_CENTI = 2_500n; // 0.25 USDC per contract, per hundredth of a contract
export const MAX_NOTIONAL = 25_000_000n;

/**
 * Everything a creator needs before signing `create`: the market's rule and conditionId, the trading
 * close, and the signer set's depth attestation (the cap). The app's sampler signs the depth at
 * once; the other samplers co-sign within seconds if their own reading agrees.
 */
export async function preparePot(db: Db, input: { symbol: string; account: Address }, own: LocalAccount | null) {
  const row = await rowBySymbol(db, input.symbol);
  if (!row) throw Object.assign(new Error("unknown market"), { status: 404 });
  const closeTime = Math.floor(row.closeMs / 1000);
  if (row.closeMs - Date.now() < 15 * 60_000) throw Object.assign(new Error("this market closes too soon for a pot"), { status: 409 });
  const params = potParams(paramsFor("demo"), POT_WINDOW_S, POT_MIN_SAMPLES);
  const conditionId = await registerMarket(db, { instrument: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, params });
  const { id, depth } = await requestDepth(db, { conditionId, account: input.account, instrument: row.symbol, closeTime }, own);
  const cap = BigInt(depth.contracts5c) * CAP_PER_CENTI;
  const b = row.book?.bid != null && row.book?.ask != null ? row.book : row;
  const mid = b.bid != null && b.ask != null ? (b.bid + b.ask) / 2 : null;
  return {
    conditionId,
    resolver: getConfig().median ?? signerSet().resolver,
    pots: potsAddress(),
    chainId: getConfig().chainId,
    closeTime,
    window: POT_WINDOW_S,
    minSamples: POT_MIN_SAMPLES,
    depthId: id,
    depth,
    cap: (cap < MAX_NOTIONAL ? cap : MAX_NOTIONAL).toString(),
    midPpm: mid === null ? null : Math.round(mid * 1e6),
    market: { symbol: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, category: row.category, closeMs: row.closeMs },
  };
}

type PotListRow = PotRow & { yes_owner: string | null; no_owner: string | null; created_tx: string | null; updated_at: string };

/** A pot with its market and its attestation requests, for the pages. */
export async function potDetail(db: Db, potId: string) {
  const row = (
    await db.query<PotListRow>(
      "SELECT pot_id::text AS pot_id, state, data, condition_id, yes_owner, no_owner, created_tx, updated_at FROM pots WHERE pot_id = $1",
      [potId],
    )
  )[0];
  if (!row) return null;
  const data = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  const market = await marketOf(db, row.condition_id);
  const requests = await db.query<ReqRow & { tx: string | null; error: string | null }>(
    "SELECT id, kind, pot_id, payload, status, digest, tx, error, created_at FROM att_requests WHERE pot_id = $1 ORDER BY created_at DESC LIMIT 30",
    [potId],
  );
  const practice = (await db.query("SELECT 1 FROM practice_pots WHERE pot_id = $1", [potId])).length > 0;
  const events = await db.query<{ tx_hash: string; block_time: string | null; event_name: string; args: Record<string, string> }>(
    "SELECT tx_hash, block_time::text AS block_time, event_name, args FROM pot_events WHERE pot_id = $1 ORDER BY block_number, log_index",
    [potId],
  );
  const row2 = market ? await rowBySymbol(db, market.instrument).catch(() => null) : null;
  // A game leaves the catalogue once it starts: then Gemini's event (which keeps its participants
  // after settlement) gives the page link and both teams in full.
  const info = market && (!row2?.slug || !row2?.teams) ? await eventInfo(market.eventTicker) : null;
  const slug = row2?.slug ?? info?.slug ?? null;
  const marketFull = market && { ...market, league: row2?.league ?? null, teams: row2?.teams ?? info?.teams ?? null, startMs: row2?.startMs ?? null, yesMeans: row2?.yesMeans ?? null, closeMs: row2?.closeMs ?? null, slug };
  return {
    potId: row.pot_id,
    state: POT_STATES[row.state],
    practice,
    data,
    owners: { yes: row.yes_owner, no: row.no_owner },
    createdTx: row.created_tx,
    updatedAt: row.updated_at,
    market: marketFull,
    // A perp's rope: which perp it belongs to and which rope it is (its two seats are the perps contract's).
    perp: (() => {
      const e = events.find((x) => x.event_name === "Perp:RopeStarted");
      return e ? { perpId: String(e.args.perpId), rope: Number(e.args.rope) } : null;
    })(),
    events: events.map((e) => ({ name: e.event_name, args: e.args, tx: e.tx_hash, at: e.block_time ? Number(e.block_time) : null })),
    // The network fee of each of this pot's transactions, in USDC base units (from the receipts).
    fees: await txFees(db, [...new Set(events.map((e) => e.tx_hash))]),
    requests: requests.map((r) => ({ id: r.id, kind: r.kind, status: r.status, tx: r.tx, error: r.error, createdAt: r.created_at, payload: payloadOf(r) })),
  };
}

/** League, both teams, start and what YES means for a market, from the catalogue (when still listed). */
/** Network fees (USDC base units) of some transactions, from the relay's receipts. */
export async function txFees(db: Db, txs: string[]): Promise<Record<string, string>> {
  if (!txs.length) return {};
  const rows = await db.query<{ tx_hash: string; fee_wei: string | null }>(
    "SELECT lower(tx_hash) AS tx_hash, fee_wei::text AS fee_wei FROM relay_txs WHERE lower(tx_hash) = ANY($1::text[]) AND fee_wei IS NOT NULL",
    [txs.map((t) => t.toLowerCase())],
  );
  return Object.fromEntries(rows.map((r) => [r.tx_hash, nativeToUsdcUnits(BigInt(r.fee_wei!)).toString()]));
}

/** The average network fee per kind of pot transaction (USDC base units), for "fee in cents" labels. */
export async function feeTable(db: Db): Promise<Record<string, string>> {
  const rows = await db.query<{ kind: string; avg: string | null }>(
    "SELECT kind, (avg(fee_wei))::bigint::text AS avg FROM relay_txs WHERE kind LIKE 'pot_%' AND fee_wei IS NOT NULL AND submitted_at > now() - interval '7 days' GROUP BY kind",
  );
  return Object.fromEntries(rows.filter((r) => r.avg).map((r) => [r.kind, nativeToUsdcUnits(BigInt(r.avg!)).toString()]));
}

/** Gemini's page slug for an event no longer in the active catalogue (finished games), cached. */
const slugCache = new Map<string, { slug: string | null; teams: string | null }>();
async function eventInfo(eventTicker: string): Promise<{ slug: string | null; teams: string | null }> {
  if (slugCache.has(eventTicker)) return slugCache.get(eventTicker)!;
  const r = await fetch(`${GEMINI_REST}/v1/prediction-markets/events/${encodeURIComponent(eventTicker)}`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
  const j = r?.ok ? ((await r.json().catch(() => null)) as { slug?: unknown; participants?: { name?: string; side?: string }[] } | null) : null;
  const slug = typeof j?.slug === "string" && /^[a-z0-9-]+$/.test(j.slug) ? j.slug : null;
  const ps = (j?.participants ?? []).filter((x) => typeof x.name === "string" && x.name);
  const away = ps.find((x) => x.side === "away");
  const home = ps.find((x) => x.side === "home");
  const teams = ps.length === 2 ? (away && home ? `${away.name} at ${home.name}` : `${ps[0]!.name} vs ${ps[1]!.name}`) : null;
  const out = { slug, teams };
  if (r?.ok) slugCache.set(eventTicker, out);
  return out;
}

async function namesFor(db: Db, instrument: string) {
  const r = await rowBySymbol(db, instrument).catch(() => null);
  return { league: r?.league ?? null, teams: r?.teams ?? null, startMs: r?.startMs ?? null, yesMeans: r?.yesMeans ?? null, closeMs: r?.closeMs ?? null, slug: r?.slug ?? null };
}

export async function listPotsHc(db: Db, opts: { owner?: string; states?: number[]; limit?: number } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (opts.owner) {
    args.push(opts.owner.toLowerCase());
    const i = args.length;
    where.push(`(yes_owner = $${i} OR no_owner = $${i} OR lower(data->>'joiner') = $${i})`);
  } else {
    // Practice pots (against the relay's practice cat) stay out of public lists and numbers.
    where.push("NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = pots.pot_id)");
  }
  if (opts.states?.length) {
    args.push(opts.states);
    where.push(`state = ANY($${args.length}::smallint[])`);
    // Pots two friends start together are reserved for the friend, so not offered to anyone else.
    if (opts.states.length === 1 && opts.states[0] === 1) where.push("NOT EXISTS (SELECT 1 FROM pot_drafts d WHERE d.data->>'potId' = pots.pot_id::text)");
  }
  args.push(opts.limit ?? 50);
  const rows = await db.query<PotListRow>(
    `SELECT pot_id::text AS pot_id, state, data, condition_id, yes_owner, no_owner, created_tx, updated_at,
            EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = pots.pot_id) AS practice FROM pots ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY pot_id DESC LIMIT $${args.length}`,
    args,
  );
  const out = [];
  for (const r of rows) {
    const m = await marketOf(db, r.condition_id);
    out.push({
      potId: r.pot_id,
      state: POT_STATES[r.state],
      data: typeof r.data === "string" ? JSON.parse(r.data) : r.data,
      owners: { yes: r.yes_owner, no: r.no_owner },
      practice: Boolean((r as PotListRow & { practice?: boolean }).practice),
      market: m && { eventTitle: m.eventTitle, label: m.label, instrument: m.instrument, eventTicker: m.eventTicker, ...(await namesFor(db, m.instrument)) },
      updatedAt: r.updated_at,
    });
  }
  return out;
}

/**
 * Pot logs delivered by QuickNode Streams (the primary path): record each event and refresh the
 * pots they touch. The RPC poller (indexPots) stays as the fallback and fills any gap.
 */
export async function ingestPotLogs(
  db: Db,
  logs: { address: Address; topics: Hex[]; data: Hex; blockNumber: bigint; transactionHash: Hex; logIndex: number }[],
  blockTime: (n: bigint) => Promise<number | null>,
) {
  const cfg = getConfig();
  if (!cfg.pots || !logs.length) return { received: 0, pots: [] as string[] };
  for (const dep of cfg.ropesAll) {
    // v2 logs (HonorCatRopes deployments), when the stream's filter includes their addresses.
    const v2 = logs.filter((l) => l.address.toLowerCase() === dep.address.toLowerCase());
    if (!v2.length) continue;
    const dec = parseEventLogs({ abi: ropesAbi, logs: v2.map((l) => ({ ...l, blockHash: null, transactionIndex: null, removed: false })) as never });
    const touched2 = new Set<string>();
    for (const l of dec) {
      const id = ropeIdOfLog(l.args, dep.idBase);
      if (id) touched2.add(id);
      await recordPotEvent(db, ropeLog(l, dep.idBase) as never, id ? BigInt(id) : null, await blockTime(l.blockNumber!).catch(() => null), "streams");
    }
    for (const id of touched2) await syncPot(db, BigInt(id)).catch((e) => console.error("[ropes] sync", id, e));
  }
  const ours = logs.filter((l) => l.address.toLowerCase() === cfg.pots!.address.toLowerCase());
  const decoded = parseEventLogs({ abi: potsAbi, logs: ours.map((l) => ({ ...l, blockHash: null, transactionIndex: null, removed: false })) as never });
  const touched = new Set<string>();
  const times = new Map<bigint, number | null>();
  for (const l of decoded) {
    const args = l.args as { potId?: bigint; tokenId?: bigint };
    const id = args.potId ?? (args.tokenId !== undefined ? args.tokenId / 2n : undefined);
    if (typeof id === "bigint") touched.add(id.toString());
    if (!times.has(l.blockNumber!)) times.set(l.blockNumber!, await blockTime(l.blockNumber!).catch(() => null));
    await recordPotEvent(db, l as never, id ?? null, times.get(l.blockNumber!) ?? null, "streams");
  }
  for (const id of touched) await syncPot(db, BigInt(id)).catch((e) => console.error("[pots] sync", id, e));
  return { received: decoded.length, pots: [...touched] };
}

/** Stores one decoded pot event (idempotent). */
export async function recordPotEvent(
  db: Db,
  l: { transactionHash: Hex | null; logIndex: number | null; blockNumber: bigint | null; eventName: string; args: unknown },
  potId: bigint | null,
  blockTime: number | null,
  source: string,
) {
  if (!l.transactionHash || l.logIndex === null || l.blockNumber === null) return;
  const args = JSON.parse(JSON.stringify(l.args, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
  await db.query(
    `INSERT INTO pot_events (tx_hash, log_index, block_number, block_time, event_name, pot_id, args, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tx_hash, log_index) DO NOTHING`,
    [l.transactionHash.toLowerCase(), l.logIndex, l.blockNumber.toString(), blockTime, l.eventName, potId?.toString() ?? null, JSON.stringify(args), source],
  );
}

/* ------------------------------------------------------------------ honor record */

type Ev = { tx_hash: string; block_time: string | null; event_name: string; pot_id: string | null; args: Record<string, string> };

/**
 * An account's honor record: facts from the pot events only. Pots played (created or joined),
 * held to the end (settled while holding a side), exits (own, by net, by bowl), handshakes,
 * takeovers (taken over by them, and their sides taken over) and the USDC paid to them.
 */
export async function honorRecord(db: Db, account: string) {
  const a = account.toLowerCase();
  // Practice pots (against the relay's practice cat) never count towards an honor record.
  const ev = await db.query<Ev>(
    "SELECT tx_hash, block_time::text AS block_time, event_name, pot_id::text AS pot_id, args FROM pot_events e WHERE e.pot_id IS NULL OR (NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = e.pot_id) AND NOT EXISTS (SELECT 1 FROM seat_pots sp WHERE sp.pot_id = e.pot_id)) ORDER BY block_number, log_index",
  );
  const ownerOf = new Map<string, string>(); // tokenId -> owner, replayed from Transfer events
  const played = new Set<string>();
  const held = new Set<string>();
  const out = { pots: 0, heldToEnd: 0, exits: 0, exitsByNet: 0, exitsByBowl: 0, partialExits: 0, handshakes: 0, tookOver: 0, takenOver: 0, joinsFailed: 0, paid: 0n, settledFor: 0, settledAgainst: 0, voided: 0, knockOuts: 0, ropesToExpiry: 0, extraLives: 0, treats: 0n };
  const pending = new Map<string, "own" | "net" | "bowl">(); // potId -> how the current exit was filed
  const exitingSide = new Map<string, number>();
  // Each entry also says what happened in fields (act, side, price, outcome), so pages can phrase it.
  type Entry = { potId: string; at: number | null; what: string; tx: string; act: string; side: number | null; price: number | null; outcome?: number; how?: string };
  const timeline: Entry[] = [];
  const mine = (potId: string, side: number) => ownerOf.get(String(BigInt(potId) * 2n + BigInt(side))) === a;
  for (const e of ev) {
    const g = e.args;
    const pid = e.pot_id ?? "";
    const at = e.block_time ? Number(e.block_time) : null;
    switch (e.event_name) {
      case "Transfer": {
        ownerOf.set(String(g.tokenId), String(g.to).toLowerCase());
        if (String(g.to).toLowerCase() === a) played.add(String(BigInt(g.tokenId!) / 2n));
        break;
      }
      case "JoinFailed":
        break;
      case "ExitRequested":
        exitingSide.set(pid, Number(g.side));
        if (!pending.has(pid)) pending.set(pid, "own");
        break;
      case "LevelTriggered":
        pending.set(pid, Number(g.kind) >= 4 ? "bowl" : "net");
        break;
      case "KnockOutTriggered":
        exitingSide.set(pid, Number(g.knockedSide));
        break;
      case "ExtraLife":
        if (mine(pid, Number(g.side))) out.extraLives++;
        break;
      case "MakerTreat":
      case "ExitFee":
      case "ReferralTreat":
      case "CopycatTreat":
        // Treats received (v2): every one is a share of a fee another player paid.
        if (String(g.to ?? g.referrer ?? g.leader).toLowerCase() === a) out.treats += BigInt(g.amount!);
        break;
      case "PotDivided": {
        // v1 names the exiting side; v2 gives a reason (0 exit, 1 knock-out, 2 expiry, 3 handshake).
        const reason = g.reason === undefined ? 0 : Number(g.reason);
        if (reason === 1 || reason === 2) {
          for (const s of [0, 1]) {
            if (!mine(pid, s)) continue;
            if (reason === 1) out.knockOuts++;
            else out.ropesToExpiry++;
            const what = reason === 1 ? (exitingSide.get(pid) === s ? "knocked out" : "other side knocked out") : "rope ended at its expiry";
            timeline.push({ potId: pid, at, what: `${what} at ${(Number(g.price) / 10_000).toFixed(1)}%`, tx: e.tx_hash, act: reason === 1 ? "knockOut" : "expiry", side: s, price: Number(g.price) });
          }
          pending.delete(pid);
          break;
        }
        if (reason === 3) {
          pending.delete(pid);
          break; // v2 handshakes are counted from the Handshake event
        }
        const side = g.exitSide !== undefined ? Number(g.exitSide) : (exitingSide.get(pid) ?? -1);
        if (side >= 0 && mine(pid, side)) {
          const how = pending.get(pid) ?? "own";
          out.exits++;
          if (how === "net") out.exitsByNet++;
          if (how === "bowl") out.exitsByBowl++;
          timeline.push({ potId: pid, at, what: `left ${side === 0 ? "YES" : "NO"} at ${(Number(g.price) / 10_000).toFixed(1)}%${how === "own" ? "" : ` (${how})`}`, tx: e.tx_hash, act: "left", side, price: Number(g.price), how });
        }
        pending.delete(pid);
        break;
      }
      case "ExitFailed":
        pending.delete(pid);
        break;
      case "Handshake":
        if (mine(pid, 0) || mine(pid, 1)) {
          out.handshakes++;
          timeline.push({ potId: pid, at, what: `shook hands at ${(Number(g.price) / 10_000).toFixed(1)}%`, tx: e.tx_hash, act: "handshake", side: null, price: Number(g.price) });
        }
        break;
      case "TakenOver":
        if (String(g.to).toLowerCase() === a) {
          out.tookOver++;
          timeline.push({ potId: pid, at, what: `took over ${Number(g.side) === 0 ? "YES" : "NO"}`, tx: e.tx_hash, act: "tookOver", side: Number(g.side), price: Number(g.price) });
        }
        if (String(g.from).toLowerCase() === a) {
          out.takenOver++;
          timeline.push({ potId: pid, at, what: `side taken over at ${(Number(g.price) / 10_000).toFixed(1)}%`, tx: e.tx_hash, act: "takenOver", side: Number(g.side), price: Number(g.price) });
        }
        pending.delete(pid);
        break;
      case "PotSettled": {
        const o = Number(g.outcome);
        for (const side of [0, 1]) {
          if (!mine(pid, side)) continue;
          held.add(pid);
          if (o === 2) out.voided++;
          else if ((o === 1 && side === 0) || (o === 0 && side === 1)) out.settledFor++;
          else out.settledAgainst++;
          timeline.push({ potId: pid, at, what: `held ${side === 0 ? "YES" : "NO"} to the end: Gemini settled ${o === 1 ? "YES" : o === 0 ? "NO" : "void"}`, tx: e.tx_hash, act: "held", side, price: null, outcome: o });
        }
        break;
      }
      case "Paid":
        if (String(g.to).toLowerCase() === a) out.paid += BigInt(g.amount!);
        break;
    }
  }
  out.pots = played.size;
  out.heldToEnd = held.size;
  const recent = timeline.reverse().slice(0, 100);
  // The market of each pot, so the page can say what each side stood for.
  const markets: Record<string, { eventTitle: string; label: string; teams?: string | null; yesMeans?: string | null } | null> = {};
  for (const pid of new Set(recent.map((t) => t.potId))) {
    const row = (await db.query<{ condition_id: string }>("SELECT condition_id FROM pots WHERE pot_id = $1", [pid]))[0];
    const m = row ? await marketOf(db, row.condition_id).catch(() => null) : null;
    markets[pid] = m ? { eventTitle: m.eventTitle, label: m.label, ...(await namesFor(db, m.instrument)) } : null;
  }
  return { account: a, ...out, paid: out.paid.toString(), treats: out.treats.toString(), timeline: recent, markets };
}

/* ------------------------------------------------------------------ quotes (fair value) */

/**
 * Opens a QUOTE window for a live pot: the samplers measure the next `window` seconds and sign the
 * result like an exit price, but the pot contract never accepts it. HonorCatFairValue turns it into
 * a side's value on-chain. At most one open quote per pot.
 */
export async function openQuote(db: Db, potId: string) {
  const row = (await db.query<PotRow>("SELECT pot_id::text AS pot_id, state, data, condition_id FROM pots WHERE pot_id = $1", [potId]))[0];
  if (!row || (row.state !== 3 && row.state !== 4)) throw Object.assign(new Error("quotes only for live pots"), { status: 409 });
  const open = await db.query<{ id: string }>(
    "SELECT id FROM att_requests WHERE pot_id = $1 AND id LIKE 'q:%' AND status IN ('measuring','proposed') AND created_at > now() - interval '5 minutes'",
    [potId],
  );
  if (open[0]) return open[0].id;
  const d = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Record<string, unknown>;
  const start = Math.floor(Date.now() / 1000) + 2;
  const id = `q:${potId}:${start}`;
  await db.query(`INSERT INTO att_requests (id, kind, pot_id, payload, status) VALUES ($1,'window',$2,$3,'measuring') ON CONFLICT (id) DO NOTHING`, [
    id,
    potId,
    JSON.stringify({ kind: KIND.quote, nonce: String(d.nonce), windowStart: start, windowEnd: start + Number(d.window), conditionId: row.condition_id, minSamples: Number(d.minSamples), resolver: String(d.resolver).toLowerCase() }),
  ]);
  return id;
}

/** The newest signed quote of a pot (attestation plus signatures in the resolver's format). */
export async function latestQuote(db: Db, potId: string) {
  const r = (
    await db.query<ReqRow>("SELECT * FROM att_requests WHERE pot_id = $1 AND id LIKE 'q:%' ORDER BY created_at DESC LIMIT 1", [potId])
  )[0];
  if (!r) return null;
  const p = payloadOf(r);
  return { id: r.id, status: r.status, attestation: (p.attestation as WindowAtt | undefined) ?? null, reason: p.reason ?? null, signatures: r.status === "ready" ? await signaturesOf(db, r.id) : null, fairValue: getConfig().fairValue };
}

/** Live evidence for /how-it-is-built: pot events per kind and per delivery path, with the newest of each. */
export async function potsEvidence(db: Db) {
  const byKind = await db.query<{ event_name: string; n: string; streams: string; rpc: string; last_tx: string; last_pot: string | null; last_time: string | null }>(
    `SELECT event_name, count(*)::text AS n,
            count(*) FILTER (WHERE source = 'streams')::text AS streams,
            count(*) FILTER (WHERE source = 'rpc')::text AS rpc,
            (array_agg(tx_hash ORDER BY block_number DESC, log_index DESC))[1] AS last_tx,
            (array_agg(pot_id::text ORDER BY block_number DESC, log_index DESC))[1] AS last_pot,
            max(block_time)::text AS last_time
       FROM pot_events e WHERE e.pot_id IS NULL OR NOT EXISTS (SELECT 1 FROM practice_pots pp WHERE pp.pot_id = e.pot_id)
      GROUP BY event_name ORDER BY event_name`,
  );
  const windows = await db.query<{ n: string; three: string; two: string; none: string; quotes: string; onchain: string }>(
    `SELECT count(*)::text AS n,
            count(*) FILTER (WHERE (payload->'attestation'->>'valid') = 'true' AND payload->>'reason' LIKE 'median of three%')::text AS three,
            count(*) FILTER (WHERE (payload->'attestation'->>'valid') = 'true' AND payload->>'reason' LIKE 'mean of two%')::text AS two,
            count(*) FILTER (WHERE (payload->'attestation'->>'valid') = 'false')::text AS none,
            count(*) FILTER (WHERE id LIKE 'q:%')::text AS quotes,
            count(*) FILTER (WHERE (payload->>'median') = 'true')::text AS onchain
       FROM att_requests WHERE kind = 'window' AND status IN ('submitted','ready') AND payload ? 'attestation'`,
  );
  const streamsShare = await db.query<{ total: string; streams: string }>(
    "SELECT count(*)::text AS total, count(*) FILTER (WHERE source = 'streams')::text AS streams FROM pot_events WHERE block_number >= $1",
    [STREAMS_POTS_SINCE_BLOCK.toString()],
  );
  const latency = await db.query<{ ms: string | null }>(
    `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (updated_at - to_timestamp((payload->>'windowEnd')::bigint))) * 1000)::text AS ms
       FROM att_requests WHERE kind = 'window' AND status = 'submitted' AND payload ? 'windowEnd'`,
  );
  const circleTx = await db.query<{ kind: string; n: string; last: string | null }>(
    `SELECT kind, count(*)::text AS n, (array_agg(tx_hash ORDER BY submitted_at DESC))[1] AS last FROM relay_txs
      WHERE kind IN ('pot_gateway','pot_exec','pot_attest','pot_settle','pot_forward','pot_house') AND submitted_at > '2026-11-16T14:20:00Z' GROUP BY kind`,
  ).catch(() => []);
  const { circleRelay } = await import("./circleWallet");
  // Everyday use: sends between players (passkey-signed transfers HonorCat paid for), the euro rate.
  const sends = await db
    .query<{ n: string; amount: string | null; last: string | null }>(
      "SELECT count(*)::text AS n, sum(amount)::text AS amount, (array_agg(tx_hash ORDER BY created_at DESC) FILTER (WHERE tx_hash IS NOT NULL))[1] AS last FROM gasless_requests WHERE kind = 'send' AND tx_hash IS NOT NULL",
    )
    .catch(() => []);
  const { eurRate } = await import("./rates");
  const [rate, fees] = await Promise.all([eurRate(), feeTable(db).catch(() => ({}) as Record<string, string>)]);
  return {
    everyday: { sends: Number(sends[0]?.n ?? 0), sentAmount: sends[0]?.amount ?? "0", lastSend: sends[0]?.last ?? null, rate, fees },
    circle: {
      relayWallet: circleRelay()?.address ?? null,
      sentByCircle: circleTx.reduce((s, r) => s + Number(r.n), 0),
      gatewayMints: Number(circleTx.find((r) => r.kind === "pot_gateway")?.n ?? 0),
      lastGatewayMint: circleTx.find((r) => r.kind === "pot_gateway")?.last ?? null,
      lastCircleTx: circleTx.map((r) => r.last).find(Boolean) ?? null,
      faucetApi: process.env.CIRCLE_API_KEY ? "key set; Circle requires a mainnet-upgraded account for the faucet API (403 until then)" : "no key",
    },
    streamsSinceFilter: { sinceBlock: STREAMS_POTS_SINCE_BLOCK.toString(), total: Number(streamsShare[0]?.total ?? 0), streams: Number(streamsShare[0]?.streams ?? 0), pollerLagBlocks: Number(POLLER_LAG_BLOCKS) },
    events: byKind,
    windows: windows[0],
    medianWindowToPaidMs: latency[0]?.ms ? Number(latency[0].ms) : null, contracts: { pots: getConfig().pots?.address ?? null, fairValue: getConfig().fairValue } };
}

/**
 * Reads the Arc Memo the payout transaction carried back from the chain (not from what the relay
 * meant to send) and keeps it with the request, so the pot page shows the reason as recorded on Arc.
 */
export async function recordMemo(db: Db, requestId: string, tx: Hex) {
  const receipt = await publicClient().waitForTransactionReceipt({ hash: tx, timeout: 30_000 });
  const memos = receipt.logs
    .filter((l) => l.address.toLowerCase() === ARC_MEMO.toLowerCase())
    .map((l) => decodeMemoLog({ topics: l.topics as Hex[], data: l.data, logIndex: l.logIndex, transactionHash: l.transactionHash, blockNumber: l.blockNumber }))
    .filter((m): m is Extract<NonNullable<ReturnType<typeof decodeMemoLog>>, { kind: "memo" }> => m?.kind === "memo");
  const texts = memos.map((m) => decodeMemoBody(m.memo).body?.why ?? decodeMemoBody(m.memo).text);
  if (!texts.length) return;
  await db.query("UPDATE att_requests SET payload = payload || $2::jsonb WHERE id = $1", [requestId, JSON.stringify({ memo: texts.join(" | "), memoBlockTime: null })]);
}

/* ------------------------------------------------------------------ sampler health */

export const SAMPLER_ALIVE_S = 120;

/**
 * Which samplers asked for work recently. With fewer than the threshold alive, no price can be
 * agreed: joins and exits wait (nothing is lost, but nothing moves). Used by /status, the pot
 * pages and /api/health/samplers (503 when below the threshold, for an uptime monitor to alert on).
 */
export async function samplersHealth(db: Db) {
  const set = signerSet();
  const now = Math.floor(Date.now() / 1000);
  const rows = await db.query<{ key: string; value: string }>("SELECT key, value FROM relay_state WHERE key LIKE 'sampler_seen:%'");
  const seen = new Map(rows.map((r) => [r.key.slice("sampler_seen:".length), Number(r.value)]));
  const samplers = set.samplers.map((a) => {
    const last = seen.get(a.toLowerCase()) ?? null;
    return { address: a, lastSeen: last, alive: last !== null && now - last <= SAMPLER_ALIVE_S };
  });
  const alive = samplers.filter((x) => x.alive).length;
  return { ok: alive >= set.threshold, alive, threshold: set.threshold, samplers, at: now };
}

/* ------------------------------------------------------------------ MedianResolver (rule on-chain) */

export const MEDIAN_NO_PRICE_DELAY = 60;

const averageTypes = {
  Average: [
    { name: "pots", type: "address" },
    { name: "potId", type: "uint256" },
    { name: "kind", type: "uint8" },
    { name: "nonce", type: "uint64" },
    { name: "windowStart", type: "uint64" },
    { name: "windowEnd", type: "uint64" },
    { name: "priceYes", type: "uint32" },
    { name: "valid", type: "bool" },
    { name: "sampleCount", type: "uint32" },
    { name: "evidenceHash", type: "bytes32" },
  ],
} as const;

/** The typed data a sampler signs for its own average of one window (MedianResolver.averageDigest). */
export function averageTyped(
  median: Address,
  w: { potId: string; kind: number; nonce: string; windowStart: number; windowEnd: number },
  v: { priceYes: number; valid: boolean; sampleCount: number; evidenceHash: Hex },
  at?: { chainId: number; pots: Address },
) {
  const chainId = at?.chainId ?? getConfig().chainId;
  const pots = at?.pots ?? potsAddress();
  return {
    domain: { name: "HonorCatMedianResolver", version: "1", chainId, verifyingContract: median },
    types: averageTypes,
    primaryType: "Average" as const,
    message: {
      pots,
      potId: BigInt(w.potId),
      kind: w.kind,
      nonce: BigInt(w.nonce),
      windowStart: BigInt(w.windowStart),
      windowEnd: BigInt(w.windowEnd),
      priceYes: v.priceYes,
      valid: v.valid,
      sampleCount: v.sampleCount,
      evidenceHash: v.evidenceHash,
    },
  };
}

/**
 * The attestation the MedianResolver will accept for these averages, by the same rule it applies:
 * median of three valid, mean of two within 0.5 points, else no price (priceYes 0, sampleCount 0).
 * "No price" waits for every sampler or 60 s after the window, as the contract requires.
 */
export function medianAttestation(w: { potId: string; kind: number; nonce: string; windowStart: number; windowEnd: number }, avgs: Avg[]): WindowAtt {
  const sorted = [...avgs].sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1));
  const prop = propose(sorted);
  const ok = prop.valid;
  return {
    potId: w.potId,
    kind: w.kind,
    nonce: w.nonce,
    windowStart: String(w.windowStart),
    windowEnd: String(w.windowEnd),
    sampleCount: ok ? Math.min(...prop.used.map((a) => a.sampleCount)) : 0,
    priceYes: ok ? Number(prop.ppm) : 0,
    valid: ok,
    evidenceHash: evidenceRootOf(sorted.map((a) => a.evidenceHash)),
  };
}

async function medianReady(db: Db, req: ReqRow, p: Record<string, unknown>, avgs: Avg[], samplerCount: number) {
  const w = { potId: chainPotId(String(req.pot_id)).toString(), kind: Number(p.kind), nonce: String(p.nonce), windowStart: Number(p.windowStart), windowEnd: Number(p.windowEnd) };
  const att = medianAttestation(w, avgs);
  if (!att.valid && avgs.length < samplerCount && Math.floor(Date.now() / 1000) < w.windowEnd + MEDIAN_NO_PRICE_DELAY) return null; // the contract would refuse it yet
  const reason = att.valid ? propose(avgs).reason : propose(avgs).reason || "no agreement";
  const digest = windowDigest(att, atOf(String(req.pot_id)));
  await db.query("UPDATE att_requests SET status = 'ready', payload = $2, digest = $3, updated_at = now() WHERE id = $1 AND status = 'measuring'", [
    req.id,
    JSON.stringify({ ...p, attestation: att, reason: `${reason} (checked on-chain)`, median: true, averages: avgs.map((a) => ({ ...a, ppm: a.ppm.toString() })) }),
    digest,
  ]);
  if (Number(p.kind) !== KIND.quote) await submitReady(db, req.id);
  return att;
}

/** 0x01 ‖ abi.encode(WindowAttestation, Average[], bytes[]) with averages in ascending signer order. */
async function medianSignature(db: Db, requestId: string, a: WindowAtt): Promise<Hex | null> {
  const rows = await db.query<{ signer: string; price_ppm: string; valid: boolean; sample_count: number; evidence_hash: string; avg_signature: string | null }>(
    "SELECT signer, price_ppm::text AS price_ppm, valid, sample_count, evidence_hash, avg_signature FROM att_averages WHERE request_id = $1",
    [requestId],
  );
  if (rows.some((r) => !r.avg_signature)) return null;
  const sorted = rows.sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : 1));
  const body = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "potId", type: "uint256" },
          { name: "kind", type: "uint8" },
          { name: "nonce", type: "uint64" },
          { name: "windowStart", type: "uint64" },
          { name: "windowEnd", type: "uint64" },
          { name: "sampleCount", type: "uint32" },
          { name: "priceYes", type: "uint32" },
          { name: "valid", type: "bool" },
          { name: "evidenceHash", type: "bytes32" },
        ],
      },
      {
        type: "tuple[]",
        components: [
          { name: "priceYes", type: "uint32" },
          { name: "valid", type: "bool" },
          { name: "sampleCount", type: "uint32" },
          { name: "evidenceHash", type: "bytes32" },
        ],
      },
      { type: "bytes[]" },
    ],
    [
      { potId: BigInt(a.potId), kind: a.kind, nonce: BigInt(a.nonce), windowStart: BigInt(a.windowStart), windowEnd: BigInt(a.windowEnd), sampleCount: a.sampleCount, priceYes: a.priceYes, valid: a.valid, evidenceHash: a.evidenceHash },
      sorted.map((r) => ({ priceYes: Number(r.price_ppm), valid: r.valid, sampleCount: r.sample_count, evidenceHash: r.evidence_hash as Hex })),
      sorted.map((r) => r.avg_signature as Hex),
    ],
  );
  return concat(["0x01", body]);
}

/* ------------------------------------------------------------------ preparing a v2 pot (short ropes) */

/** Whether new pots can use HonorCat v2 (deployed and switched on by the owner), and its fixed rules. */
export function ropesStatus() {
  const r = getConfig().ropes;
  return {
    available: Boolean(r && r.median),
    forNewPots: Boolean(r && r.median && r.forNewPots),
    address: r?.address ?? null,
    idBase: (r?.idBase ?? 1_000_000_000n).toString(),
    perps: r?.perps ?? null,
    perpsForNewPots: Boolean(r?.perps && r.perpsForNewPots),
    rules: { expiryLeadS: 7200, maxLifeS: 7 * 86_400, minLifeS: 600, minDistancePpm: 50_000, maxLeverageCrypto: 10, maxLeverageOther: 5, maxLives: 8 },
    fees: { operatorBps: 0, exitFeeBps: 100, makerTreatBps: 25, referralShareBps: 2_000, referralPots: 20, copycatBps: 500 },
  };
}

/**
 * Everything a creator needs before signing a v2 `create`: the rule and conditionId, the close, and
 * the signer set's depth attestation with the spread (the shortest rope) and the category (the most
 * leverage). The cap is on the size: at most a quarter of the contracts resting within 5¢ on the
 * thinner side, and the pot never above the testnet maximum.
 */
export async function prepareRope(db: Db, input: { symbol: string; account: Address }, own: LocalAccount | null) {
  const r = getConfig().ropes;
  if (!r || !r.median) throw Object.assign(new Error("HonorCat v2 is not deployed yet"), { status: 409 });
  const row = await rowBySymbol(db, input.symbol);
  if (!row) throw Object.assign(new Error("unknown market"), { status: 404 });
  const closeTime = Math.floor(row.closeMs / 1000);
  if (row.closeMs - Date.now() < 15 * 60_000) throw Object.assign(new Error("this market closes too soon for a pot"), { status: 409 });
  const params = potParams(paramsFor("demo"), POT_WINDOW_S, POT_MIN_SAMPLES);
  const conditionId = await registerMarket(db, { instrument: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, params });
  const crypto = row.category === "Crypto";
  const { id, depth } = await requestDepthV2(db, { conditionId, account: input.account, instrument: row.symbol, closeTime, crypto }, own);
  const b = row.book?.bid != null && row.book?.ask != null ? row.book : row;
  const mid = b.bid != null && b.ask != null ? (b.bid + b.ask) / 2 : null;
  return {
    v2: true as const,
    idBase: r.idBase.toString(),
    conditionId,
    resolver: r.median,
    pots: r.address,
    chainId: getConfig().chainId,
    closeTime,
    window: POT_WINDOW_S,
    minSamples: POT_MIN_SAMPLES,
    depthId: id,
    depth,
    maxSize: (BigInt(depth.contracts5c) / 4n).toString(),
    maxPot: MAX_NOTIONAL.toString(),
    spread: depth.spread ?? 0,
    crypto,
    midPpm: mid === null ? null : Math.round(mid * 1e6),
    market: { symbol: row.symbol, eventTicker: row.eventTicker, contractTicker: row.contractTicker, eventTitle: row.eventTitle, label: row.label, category: row.category, closeMs: row.closeMs },
  };
}
