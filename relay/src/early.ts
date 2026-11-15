import { randomBytes } from "node:crypto";
import {
  concat,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  recoverTypedDataAddress,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { batchGuardAbi, guaranteeBookAbi, verdictVaultAbi } from "./abi";
import { publicClient } from "./chain";
import { registerCondition } from "./conditions";
import { getConfig } from "./config";
import type { Db } from "./db";
import {
  checkPolicy,
  createNonce,
  GaslessError,
  logRequest,
  prepareGasless,
  toContractAuth,
  verifySigner,
  type PotParams,
  type SignedAuthorization,
} from "./gasless";
import { memoCall, type MemoBody } from "./memo";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { resolutionDomain, resolutionTypes } from "./signer";
import { fetchMarketState } from "./sampler";
import { sendRelayCalls, type RelayCall } from "./txs";
import { aggregate, recordFromJson, recordToJson, type SignedTrigger } from "./trigger/evidence";
import { conditionIdForTrigger, validateParams, type PotMode, type TriggerParams, type TriggerSide } from "./trigger/params";

/**
 * HonorCat early payouts. On-chain shape (no vault change): one VerdictVault pot whose resolver is
 * the samplers' 2-of-3 MultisigResolver, whose only payee is the GuaranteeBook (recipients enrol
 * there, each is paid `amount`) and whose refundTo is the funder. The pot's conditionId commits to
 * the Gemini contract, the side, the pot mode and every trigger parameter.
 *
 * Lifecycle: Locked (recipients join) until lockTime, then Armed until trading closes. Samplers
 * sign "triggered" (with evidence), or after trading closes "not crossed" (early-only), or the
 * settled outcome (early-or-outcome), or "voided". The relay settles once 2 of 3 agree.
 */

export type EarlyTerms = {
  name: string; // funder / promotion name shown to recipients
  funder: Address;
  eventTicker: string;
  contractTicker: string;
  instrument: string; // Gemini instrumentSymbol
  side: TriggerSide;
  mode: PotMode;
  template: "demo" | "standard";
  params: TriggerParams;
  amount: bigint; // per recipient, 6-dp USDC
  maxRecipients: number;
  lockTime: number; // joining closes; arming starts
  tradingClose: number; // arming ends (contract / event expiry)
  deadline: number; // pot deadline
  eventTitle: string;
  contractLabel: string;
  promise: string;
  listed?: boolean;
};

export type EarlyConfig = { resolver: Address; samplers: Address[]; threshold: number };

export function requireEarly(): EarlyConfig & { book: Address; guard: Address } {
  const cfg = getConfig();
  if (!cfg.early || !cfg.guarantees) throw new GaslessError("Early payouts are not configured on this deployment", 503);
  return { ...cfg.early, book: cfg.guarantees.book, guard: cfg.guarantees.guard };
}

export const earlyConditionId = (t: Pick<EarlyTerms, "instrument" | "side" | "mode" | "params">) =>
  conditionIdForTrigger({ instrument: t.instrument, side: t.side, mode: t.mode, params: t.params });

export function validateEarly(t: EarlyTerms) {
  const now = Math.floor(Date.now() / 1000);
  validateParams(t.params);
  if (!t.name.trim() || t.name.length > 60) throw new GaslessError("name is required (max 60 characters)");
  if (t.amount < 10_000n) throw new GaslessError("amount per recipient must be at least 0.01 USDC");
  if (t.maxRecipients < 1 || t.maxRecipients > 50) throw new GaslessError("between 1 and 50 recipients");
  if (t.lockTime <= now + 20) throw new GaslessError("joining must stay open for at least 20 seconds");
  if (t.lockTime + t.params.windowMs / 1000 > t.tradingClose) throw new GaslessError("the market closes before one full trigger window after joining closes");
  if (t.deadline <= t.tradingClose) throw new GaslessError("the pot deadline must be after trading closes");
  if (!/^GEMI-[A-Z0-9-]+$/i.test(t.instrument)) throw new GaslessError("not a Gemini prediction-market instrument");
}

function potParams(t: EarlyTerms, e: ReturnType<typeof requireEarly>): PotParams {
  return {
    conditionId: earlyConditionId(t),
    resolver: e.resolver,
    payees: [e.book],
    sharesBps: [10_000],
    refundTo: getAddress(t.funder),
    deadline: BigInt(t.deadline),
  };
}

/** Typed data the funder signs once: one EIP-3009 authorization for every recipient's amount. */
export async function prepareEarly(t: EarlyTerms) {
  validateEarly(t);
  const e = requireEarly();
  const params = potParams(t, e);
  const amount = t.amount * BigInt(t.maxRecipients);
  const prepared = await prepareGasless({ kind: "create", params, from: getAddress(t.funder), amount, validForSeconds: 900 });
  return { params, amount, prepared };
}

const newId = () => randomBytes(8).toString("base64url").slice(0, 10);
const usd = (v: bigint) => (Number(v) / 1e6).toFixed(2);

/** Creates and funds the pot and opens the recipient list in ONE atomic Multicall3From transaction. */
export async function createEarly(db: Db, t: EarlyTerms, auth: SignedAuthorization, integration: string | null = null) {
  validateEarly(t);
  const cfg = getConfig();
  const e = requireEarly();
  const params = potParams(t, e);
  const amount = t.amount * BigInt(t.maxRecipients);
  if (getAddress(auth.from) !== getAddress(t.funder)) throw new GaslessError("authorization must come from the funder");
  await checkPolicy(db, auth.from, amount, integration ?? "early");
  await verifySigner(auth, amount, createNonce(cfg.chainId, cfg.vault, params, auth.salt));

  const id = newId();
  const ref = `early-${id}`;
  await registerCondition(db, "early", id, `${t.eventTitle} — ${t.contractLabel}${t.side === "no" ? " (No)" : ""}`);
  await db.query(
    `INSERT INTO early_pots (id, name, funder, event_ticker, contract_ticker, instrument, side, mode, template, params, amount,
       max_recipients, lock_time, trading_close, deadline, event_title, contract_label, promise, condition_id, resolver, listed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
    [
      id,
      t.name.trim(),
      getAddress(t.funder).toLowerCase(),
      t.eventTicker,
      t.contractTicker,
      t.instrument,
      t.side,
      t.mode,
      t.template,
      JSON.stringify(t.params),
      t.amount.toString(),
      t.maxRecipients,
      t.lockTime,
      t.tradingClose,
      t.deadline,
      t.eventTitle,
      t.contractLabel,
      t.promise,
      params.conditionId.toLowerCase(),
      e.resolver.toLowerCase(),
      t.listed !== false,
    ],
  );

  const createData = encodeFunctionData({ abi: verdictVaultAbi, functionName: "createPotWithAuthorization", args: [params, amount, toContractAuth(auth)] });
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const potId = (await publicClient().readContract({ address: cfg.vault, abi: verdictVaultAbi, functionName: "potCount" })) + 1n;
    const res = await sendRelayCalls(
      db,
      "early_create",
      [
        { target: e.guard, callData: encodeFunctionData({ abi: batchGuardAbi, functionName: "expectNextPotId", args: [cfg.vault, potId] }), label: "guard" },
        {
          ...memoCall(cfg.vault, createData, ref, {
            v: 1,
            t: "fund",
            ref,
            pot: potId.toString(),
            why: `${t.name.trim()} locked ${usd(amount)} USDC for up to ${t.maxRecipients} early payouts of ${usd(t.amount)} USDC`,
          }),
          potIds: [potId.toString()],
          label: "create",
        },
        {
          target: e.book,
          callData: encodeFunctionData({ abi: guaranteeBookAbi, functionName: "open", args: [potId, t.amount, t.maxRecipients, BigInt(t.lockTime)] }),
          label: "open",
        },
      ],
      { atomic: true },
    );
    if (res.ok) {
      const gid = await publicClient().readContract({ address: e.book, abi: guaranteeBookAbi, functionName: "guaranteeOfPot", args: [potId] });
      await db.query("UPDATE early_pots SET pot_id = $2, gid = $3, created_tx = $4, status = 'live' WHERE id = $1", [id, potId.toString(), gid.toString(), res.tx]);
      await logRequest(db, auth.from, integration ?? "early", "early", amount, res.tx);
      return { id, potId: potId.toString(), gid: gid.toString(), conditionId: params.conditionId, tx: res.tx };
    }
    lastError = res.error;
    if (!/UnexpectedPotId/.test(res.error)) break;
  }
  await db.query("UPDATE early_pots SET status = 'failed', error = $2 WHERE id = $1", [id, lastError.slice(0, 300)]);
  throw new GaslessError(`could not create the early payout: ${lastError}`, 502);
}

// ------------------------------------------------------------------ recipients

export const earlyJoinMessage = (id: string, account: Address) => `Join HonorCat early payout ${id} as ${getAddress(account)}`;

export async function joinEarly(db: Db, id: string, account: Address, proof: { kind: "eoa"; signature: Hex } | { kind: "passkey"; assertion: WebAuthnAssertion }) {
  const e = requireEarly();
  const row = (await db.query<{ gid: string | null; lock_time: string }>("SELECT gid::text AS gid, lock_time::text AS lock_time FROM early_pots WHERE id = $1", [id]))[0];
  if (!row?.gid) throw new GaslessError("early payout not found or not open yet", 404);
  if (Number(row.lock_time) <= Math.floor(Date.now() / 1000)) throw new GaslessError("joining has closed", 409);
  if (proof.kind === "eoa") {
    if (!(await verifyMessage({ address: getAddress(account), message: earlyJoinMessage(id, account), signature: proof.signature }))) {
      throw new GaslessError("signature does not match the account", 401);
    }
  } else {
    await verifyPasskeyJoin(db, getAddress(account), earlyJoinMessage(id, account), proof.assertion);
  }
  const already = await db.query(
    `SELECT 1 FROM chain_events WHERE contract = 'book' AND event_name = 'Enrolled' AND gid = $1 AND args->>'account' = $2`,
    [row.gid, account.toLowerCase()],
  );
  if (already.length) return { id, account, alreadyJoined: true };
  const res = await sendRelayCalls(db, "early_join", [
    { target: e.book, callData: encodeFunctionData({ abi: guaranteeBookAbi, functionName: "enrol", args: [BigInt(row.gid), getAddress(account)] }), label: "enrol" },
  ]);
  if (!res.ok) {
    const err = res.dropped[0]?.error ?? res.error;
    throw new GaslessError(err === "Full" ? "all places are taken" : err === "EnrolmentClosed" ? "joining has closed" : err === "AlreadyEnrolled" ? "already joined" : err, /Full|Closed|Enrolled|NotCovered/.test(err) ? 409 : 502);
  }
  return { id, account, tx: res.tx };
}

// ------------------------------------------------------------------ samplers' view

type EarlyRow = {
  id: string;
  pot_id: string | null;
  gid: string | null;
  name: string;
  funder: string;
  event_ticker: string;
  contract_ticker: string;
  instrument: string;
  side: TriggerSide;
  mode: PotMode;
  template: string;
  params: TriggerParams | string;
  amount: string;
  max_recipients: number;
  lock_time: string;
  trading_close: string;
  deadline: string;
  event_title: string;
  contract_label: string;
  promise: string;
  condition_id: Hex;
  resolver: string;
  status: string;
  listed: boolean;
  created_tx: string | null;
  settled_kind: string | null;
  settled_tx: string | null;
  evidence_root: string | null;
  record_occurred: boolean | null;
  record_status: string | null;
  record_tx: string | null;
  record_at: string | null;
  pot_status: string | null;
  pot_outcome: boolean | null;
  created_at: string;
};

const SELECT = `
  SELECT e.*, e.pot_id::text AS pot_id, e.gid::text AS gid, e.amount::text AS amount, e.lock_time::text AS lock_time,
         e.trading_close::text AS trading_close, e.deadline::text AS deadline, e.created_at::text AS created_at,
         e.record_at::text AS record_at, p.status AS pot_status, p.outcome AS pot_outcome
  FROM early_pots e LEFT JOIN pots p ON p.pot_id = e.pot_id`;

export type ArmedPot = {
  id: string;
  potId: string;
  gid: string;
  chainId: number;
  vault: Address;
  resolver: Address;
  conditionId: Hex;
  instrument: string;
  eventTicker: string;
  contractTicker: string;
  side: TriggerSide;
  mode: PotMode;
  params: TriggerParams;
  lockTime: number;
  tradingClose: number;
  deadline: number;
  /** Kinds this signer has already submitted for the pot. */
  submitted: string[];
};

const parseParams = (p: TriggerParams | string): TriggerParams => (typeof p === "string" ? (JSON.parse(p) as TriggerParams) : p);

/** Pots samplers must watch: live, funded, still open on-chain, before the deadline. */
export async function armedPots(db: Db, signer?: Address): Promise<ArmedPot[]> {
  const cfg = getConfig();
  const rows = await db.query<EarlyRow>(`${SELECT} WHERE e.status = 'live' AND e.pot_id IS NOT NULL AND (p.status IS NULL OR p.status = 'open') ORDER BY e.created_at`);
  const subs = signer
    ? await db.query<{ early_id: string; kind: string }>("SELECT early_id, kind FROM early_signatures WHERE signer = $1", [signer.toLowerCase()])
    : [];
  return rows.map((r) => ({
    id: r.id,
    potId: r.pot_id!,
    gid: r.gid!,
    chainId: cfg.chainId,
    vault: cfg.vault,
    resolver: getAddress(r.resolver),
    conditionId: r.condition_id,
    instrument: r.instrument,
    eventTicker: r.event_ticker,
    contractTicker: r.contract_ticker,
    side: r.side,
    mode: r.mode,
    params: parseParams(r.params),
    lockTime: Number(r.lock_time),
    tradingClose: Number(r.trading_close),
    deadline: Number(r.deadline),
    submitted: subs.filter((s) => s.early_id === r.id).map((s) => s.kind),
  }));
}

/** A sampler's signed outcome. Trigger submissions carry evidence; the others carry a reason. */
export type SamplerSubmission =
  | { kind: "trigger"; record: Record<string, unknown>; attestation: Hex; resolution: Hex }
  | { kind: "close" | "void" | "settle"; signer: Address; outcome: boolean; resolution: Hex; reason: string; observed: Record<string, unknown> };

/** Accepts one sampler submission after checking it in full; idempotent per (pot, signer, kind). */
export async function submitEarlySignature(db: Db, id: string, sub: SamplerSubmission) {
  const e = requireEarly();
  const cfg = getConfig();
  const row = (await db.query<EarlyRow>(`${SELECT} WHERE e.id = $1`, [id]))[0];
  if (!row?.pot_id) throw new GaslessError("early payout not found", 404);
  const expected = { chainId: cfg.chainId, vault: cfg.vault, potId: BigInt(row.pot_id), conditionId: row.condition_id, signers: e.samplers, threshold: 1 };
  let signer: Address;
  let outcome: boolean;
  let evidenceHash: Hex | null = null;
  let recordJson: unknown = null;
  if (sub.kind === "trigger") {
    const record = recordFromJson(sub.record);
    const a = await aggregate([{ record, attestation: sub.attestation, resolution: sub.resolution } as SignedTrigger], expected);
    if (!a.ok) throw new GaslessError(`rejected: ${a.rejected[0]?.reason ?? a.reason}`, 400);
    if (record.windowStart < Number(row.lock_time) * 1000) throw new GaslessError("rejected: the window starts before the pot was armed", 400);
    if (record.windowEnd > Number(row.trading_close) * 1000) throw new GaslessError("rejected: the window ends after trading closed", 400);
    signer = record.signer;
    outcome = true;
    evidenceHash = a.evidenceHashes[0]!;
    recordJson = recordToJson(record);
  } else {
    signer = getAddress(sub.signer);
    if (!e.samplers.includes(signer)) throw new GaslessError("not an authorised sampler", 403);
    const who = await recoverTypedDataAddress({
      domain: resolutionDomain(cfg.chainId, cfg.vault),
      types: resolutionTypes,
      primaryType: "Resolution",
      message: { potId: BigInt(row.pot_id), conditionId: row.condition_id, outcome: sub.outcome },
      signature: sub.resolution,
    });
    if (getAddress(who) !== signer) throw new GaslessError("resolution signature does not match the sampler", 401);
    if (sub.kind === "close" && (row.mode !== "early-only" || sub.outcome)) throw new GaslessError("'close' is a no-payout result of an early-only pot", 400);
    if (sub.kind === "void" && sub.outcome) throw new GaslessError("a voided market never pays", 400);
    if (sub.kind === "settle" && row.mode !== "early-or-outcome") throw new GaslessError("'settle' is only for early-or-outcome pots", 400);
    outcome = sub.outcome;
    recordJson = { reason: sub.reason.slice(0, 300), observed: sub.observed };
  }
  await db.query(
    `INSERT INTO early_signatures (early_id, signer, kind, outcome, evidence_hash, record, attestation, resolution)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (early_id, signer, kind) DO NOTHING`,
    [id, signer.toLowerCase(), sub.kind, outcome, evidenceHash, JSON.stringify(recordJson), sub.kind === "trigger" ? sub.attestation : null, sub.resolution],
  );
  return { id, signer, kind: sub.kind, outcome, evidenceHash };
}

/** Recent samples a sampler reports for the live chart (not used for decisions; those use records). */
export async function submitEarlySamples(db: Db, id: string, signer: Address, samples: { t: number; mid: number | null; status: number }[], signature: Hex) {
  const e = requireEarly();
  if (!e.samplers.includes(getAddress(signer))) throw new GaslessError("not an authorised sampler", 403);
  const body = JSON.stringify({ id, samples });
  if (!(await verifyMessage({ address: getAddress(signer), message: body, signature }))) throw new GaslessError("bad sampler signature", 401);
  const rows = samples.slice(-200);
  for (let k = 0; k < rows.length; k += 100) {
    const chunk = rows.slice(k, k + 100);
    const params: unknown[] = [];
    const values = chunk.map((s, j) => {
      params.push(id, signer.toLowerCase(), s.t, s.mid === null ? null : Math.round(s.mid * 1e6), s.status);
      const b = j * 5;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
    });
    if (values.length) {
      await db.query(`INSERT INTO early_samples (early_id, signer, t, mid_micro, status) VALUES ${values.join(",")} ON CONFLICT DO NOTHING`, params);
    }
  }
  return { stored: rows.length };
}

// ------------------------------------------------------------------ settlement (relay tick)

export type EarlyAction = { id: string; action: string; tx?: Hex; result: string };

/** Combines `threshold` resolution signatures in ascending signer order (MultisigResolver format). */
function combine(sigs: { signer: string; resolution: Hex }[], threshold: number): Hex {
  return concat(
    [...sigs]
      .sort((a, b) => (BigInt(a.signer) < BigInt(b.signer) ? -1 : 1))
      .slice(0, threshold)
      .map((s) => s.resolution),
  );
}

export async function processEarly(db: Db): Promise<EarlyAction[]> {
  const cfg = getConfig();
  if (!cfg.early || !cfg.guarantees) return [];
  const e = requireEarly();
  const out: EarlyAction[] = [];
  const rows = await db.query<EarlyRow>(`${SELECT} WHERE e.status = 'live' AND e.pot_id IS NOT NULL AND e.settled_tx IS NULL ORDER BY e.created_at`);
  const grace = await publicClient().readContract({ address: cfg.vault, abi: verdictVaultAbi, functionName: "gracePeriod" });
  const now = Math.floor(Date.now() / 1000);

  for (const r of rows) {
    if (r.pot_status && r.pot_status !== "open") {
      await db.query("UPDATE early_pots SET settled_kind = COALESCE(settled_kind, 'external'), settled_tx = COALESCE(settled_tx, 'external') WHERE id = $1", [r.id]);
      continue;
    }
    const subs = await db.query<{ signer: string; kind: string; outcome: boolean; record: unknown; attestation: Hex | null; resolution: Hex }>(
      "SELECT signer, kind, outcome, record, attestation, resolution FROM early_signatures WHERE early_id = $1",
      [r.id],
    );
    const ref = `early-${r.id}`;
    const potId = BigInt(r.pot_id!);
    let calls: RelayCall[] | null = null;
    let kind = "";
    let root: Hex | null = null;
    let outcome = false;

    const triggers = subs.filter((s) => s.kind === "trigger");
    if (triggers.length >= e.threshold) {
      const a = await aggregate(
        triggers.map((s) => ({ record: recordFromJson((typeof s.record === "string" ? JSON.parse(s.record) : s.record) as Record<string, unknown>), attestation: s.attestation!, resolution: s.resolution })),
        { chainId: cfg.chainId, vault: cfg.vault, potId, conditionId: r.condition_id, signers: e.samplers, threshold: e.threshold },
      );
      if (a.ok) {
        root = a.evidenceRoot;
        outcome = true;
        kind = "early";
        const avg = triggers
          .map((s) => recordFromJson((typeof s.record === "string" ? JSON.parse(s.record) : s.record) as Record<string, unknown>))
          .find((rec) => a.signers.includes(rec.signer));
        const pct = avg ? (Number(avg.averageMicro) / 10 ** (avg.params.priceDecimals + 6)) * 100 : null;
        const body: MemoBody = {
          v: 1,
          t: "early",
          ref,
          pot: r.pot_id!,
          root,
          src: "gemini",
          mkt: r.instrument,
          why: `Paid early: ${a.signers.length} independent samplers saw the market average ${pct === null ? "?" : pct.toFixed(1)}% over ${(r.params && parseParams(r.params).windowMs / 1000) || "?"} s, at or above ${(parseParams(r.params).thresholdBps / 100).toFixed(0)}%`,
        };
        calls = [
          { ...memoCall(cfg.vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "resolve", args: [potId, true, a.resolverSignature] }), ref, body), potIds: [r.pot_id!], label: "resolve" },
          { ...memoCall(e.book, encodeFunctionData({ abi: guaranteeBookAbi, functionName: "payout", args: [BigInt(r.gid!), 50n] }), ref, { v: 1, t: "refunds", ref, pot: r.pot_id!, root, why: "Early payout to every recipient" }), potIds: [r.pot_id!], label: "payout" },
        ];
      }
    }
    if (!calls) {
      for (const want of [false, true]) {
        const agree = subs.filter((s) => s.kind !== "trigger" && s.outcome === want);
        if (agree.length < e.threshold) continue;
        outcome = want;
        kind = agree.some((s) => s.kind === "void") ? "void" : agree[0]!.kind;
        const sig = combine(agree, e.threshold);
        const why =
          kind === "void"
            ? "The market was voided before any early payout; the funder gets everything back"
            : kind === "close"
              ? "Trading closed without the threshold being crossed; the funder gets everything back"
              : want
                ? "The event occurred (settled market); every recipient is paid"
                : "The event did not occur; the funder gets everything back";
        const body: MemoBody = { v: 1, t: want ? "payout" : "refund", ref, pot: r.pot_id!, src: "gemini", mkt: r.instrument, why };
        calls = [{ ...memoCall(cfg.vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "resolve", args: [potId, want, sig] }), ref, body), potIds: [r.pot_id!], label: "resolve" }];
        if (want) {
          calls.push({ ...memoCall(e.book, encodeFunctionData({ abi: guaranteeBookAbi, functionName: "payout", args: [BigInt(r.gid!), 50n] }), ref, { v: 1, t: "refunds", ref, pot: r.pot_id!, why: "Payment to every recipient" }), potIds: [r.pot_id!], label: "payout" });
        }
        break;
      }
    }
    if (!calls && BigInt(now) > BigInt(r.deadline) + grace) {
      kind = "expire";
      calls = [{ ...memoCall(cfg.vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "expire", args: [potId] }), ref, { v: 1, t: "expire", ref, pot: r.pot_id!, why: "No result before the deadline; the funder gets everything back" }), potIds: [r.pot_id!], label: "expire" }];
    }
    if (!calls) continue;
    const res = await sendRelayCalls(db, "early_settle", calls, { atomic: true });
    if (res.ok) {
      await db.query("UPDATE early_pots SET settled_kind = $2, settled_tx = $3, evidence_root = $4, settled_at = now(), settled_outcome = $5 WHERE id = $1", [r.id, kind, res.tx, root, outcome]);
      out.push({ id: r.id, action: kind, tx: res.tx, result: "confirmed" });
    } else {
      out.push({ id: r.id, action: kind, tx: res.tx, result: `error: ${res.error}` });
      if (/PotNotOpen/.test(res.error)) await db.query("UPDATE early_pots SET settled_kind = 'external', settled_tx = 'external' WHERE id = $1", [r.id]);
    }
  }
  out.push(...(await recordSettledOutcomes(db)));
  return out;
}

/**
 * After an early payout, waits for Gemini to settle (or void) the market and records publicly
 * whether the event occurred. Checks each pot at most every 5 minutes, a few pots per tick.
 */
async function recordSettledOutcomes(db: Db): Promise<EarlyAction[]> {
  const out: EarlyAction[] = [];
  const due = await db.query<{ id: string; event_ticker: string; contract_ticker: string; side: TriggerSide }>(
    `SELECT e.id, e.event_ticker, e.contract_ticker, e.side FROM early_pots e
     LEFT JOIN relay_state s ON s.key = 'early_record_check:' || e.id
     WHERE e.settled_kind = 'early' AND e.record_tx IS NULL AND e.trading_close < extract(epoch from now())
       AND (s.value IS NULL OR s.value::bigint < extract(epoch from now()) * 1000 - 300000)
     ORDER BY e.trading_close LIMIT 5`,
  );
  for (const p of due) {
    await db.query(
      `INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`early_record_check:${p.id}`, String(Date.now())],
    );
    const m = await fetchMarketState(p.event_ticker, p.contract_ticker);
    if (!m) continue;
    let observed: Parameters<typeof recordEarlyOutcome>[2] | null = null;
    if (m.status === "invalid") observed = { occurred: null, status: "voided", resolutionSide: null };
    else if (m.status === "settled" && m.resolutionSide) {
      const occurred = m.resolutionSide === p.side;
      observed = { occurred, status: occurred ? "confirmed" : "market_wrong", resolutionSide: m.resolutionSide };
    }
    if (!observed) continue;
    const r = await recordEarlyOutcome(db, p.id, observed);
    if (r) out.push({ id: p.id, action: `record:${observed.status}`, tx: "tx" in r ? r.tx : undefined, result: "error" in r ? `error: ${r.error}` : "confirmed" });
  }
  return out;
}

/**
 * After the market settles, records publicly whether an early payout's event occurred: an Arc Memo
 * on a read-only call to the vault (getPot), linked to the pot by its memo id.
 */
export async function recordEarlyOutcome(db: Db, id: string, observed: { occurred: boolean | null; status: "confirmed" | "market_wrong" | "voided"; resolutionSide: string | null }) {
  const cfg = getConfig();
  const r = (await db.query<EarlyRow>(`${SELECT} WHERE e.id = $1`, [id]))[0];
  if (!r?.pot_id || r.record_tx) return null;
  const ref = `early-${r.id}`;
  const why =
    observed.status === "confirmed"
      ? "Market settled: the event occurred. The early payout was right."
      : observed.status === "market_wrong"
        ? "Market settled: the event did not occur. The market was wrong; the early payout stands."
        : "The market was voided after the early payout; the payout stands.";
  const res = await sendRelayCalls(db, "early_record", [
    { ...memoCall(cfg.vault, encodeFunctionData({ abi: verdictVaultAbi, functionName: "getPot", args: [BigInt(r.pot_id)] }), ref, { v: 1, t: "record", ref, pot: r.pot_id, src: "gemini", mkt: r.instrument, res: observed.resolutionSide === "yes" ? "YES" : observed.resolutionSide === "no" ? "NO" : undefined, why }), potIds: [r.pot_id], label: "record" },
  ]);
  if (!res.ok) return { id, error: res.error };
  await db.query("UPDATE early_pots SET record_occurred = $2, record_status = $3, record_tx = $4, record_at = now() WHERE id = $1", [id, observed.occurred, observed.status, res.tx]);
  return { id, tx: res.tx };
}

// ------------------------------------------------------------------ reads

export type EarlyDto = {
  id: string;
  potId: string | null;
  gid: string | null;
  name: string;
  funder: Address;
  eventTicker: string;
  contractTicker: string;
  instrument: string;
  side: TriggerSide;
  mode: PotMode;
  template: string;
  params: TriggerParams;
  amount: string;
  maxRecipients: number;
  lockTime: number;
  tradingClose: number;
  deadline: number;
  eventTitle: string;
  contractLabel: string;
  promise: string;
  conditionId: Hex;
  resolver: Address;
  listed: boolean;
  createdTx: string | null;
  state: "locked" | "armed" | "triggered" | "paid" | "refunded" | "closed" | "failed" | "pending";
  settledKind: string | null;
  settledTx: string | null;
  evidenceRoot: string | null;
  record: { occurred: boolean | null; status: string; tx: string | null; at: string | null } | null;
  createdAt: string;
};

function stateOf(r: EarlyRow): EarlyDto["state"] {
  if (r.status === "failed") return "failed";
  if (r.status !== "live") return "pending";
  if (r.pot_status === "resolved") return r.pot_outcome ? "paid" : "refunded";
  if (r.pot_status === "expired") return "refunded";
  const now = Date.now() / 1000;
  if (now < Number(r.lock_time)) return "locked";
  if (now < Number(r.trading_close)) return "armed";
  return "closed";
}

const toDto = (r: EarlyRow): EarlyDto => ({
  id: r.id,
  potId: r.pot_id,
  gid: r.gid,
  name: r.name,
  funder: getAddress(r.funder),
  eventTicker: r.event_ticker,
  contractTicker: r.contract_ticker,
  instrument: r.instrument,
  side: r.side,
  mode: r.mode,
  template: r.template,
  params: parseParams(r.params),
  amount: r.amount,
  maxRecipients: r.max_recipients,
  lockTime: Number(r.lock_time),
  tradingClose: Number(r.trading_close),
  deadline: Number(r.deadline),
  eventTitle: r.event_title,
  contractLabel: r.contract_label,
  promise: r.promise,
  conditionId: r.condition_id,
  resolver: getAddress(r.resolver),
  listed: r.listed,
  createdTx: r.created_tx,
  state: stateOf(r),
  settledKind: r.settled_kind,
  settledTx: r.settled_tx,
  evidenceRoot: r.evidence_root,
  record: r.record_status ? { occurred: r.record_occurred, status: r.record_status, tx: r.record_tx, at: r.record_at } : null,
  createdAt: r.created_at,
});

export async function listEarly(db: Db, opts: { listedOnly?: boolean } = {}) {
  const rows = await db.query<EarlyRow>(`${SELECT} WHERE e.status = 'live' ${opts.listedOnly === false ? "" : "AND e.listed"} ORDER BY e.created_at DESC LIMIT 100`);
  return rows.map(toDto);
}

export async function earlyDetail(db: Db, id: string) {
  const r = (await db.query<EarlyRow>(`${SELECT} WHERE e.id = $1`, [id]))[0];
  if (!r) return null;
  const dto = toDto(r);
  const signatures = await db.query<{ signer: string; kind: string; outcome: boolean; evidence_hash: string | null; record: unknown; attestation: string | null; resolution: string; created_at: string }>(
    "SELECT signer, kind, outcome, evidence_hash, record, attestation, resolution, created_at::text AS created_at FROM early_signatures WHERE early_id = $1 ORDER BY created_at",
    [id],
  );
  const recipients = r.gid
    ? await db.query<{ account: string; seat: string; tx_hash: string; block_time: string | null }>(
        `SELECT args->>'account' AS account, args->>'seat' AS seat, tx_hash, block_time::text AS block_time FROM chain_events
         WHERE contract = 'book' AND event_name = 'Enrolled' AND gid = $1 ORDER BY block_number, log_index`,
        [r.gid],
      )
    : [];
  const payments = r.gid
    ? await db.query<{ account: string; amount: string; tx_hash: string; event_name: string }>(
        `SELECT COALESCE(args->>'account', args->>'merchant') AS account, args->>'amount' AS amount, tx_hash, event_name FROM chain_events
         WHERE contract = 'book' AND event_name IN ('RefundPaid', 'RefundDeferred', 'LeftoverReturned') AND gid = $1 ORDER BY block_number, log_index`,
        [r.gid],
      )
    : [];
  const samples = await db.query<{ signer: string; t: string; mid_micro: string | null; status: number }>(
    `SELECT signer, t::text AS t, mid_micro::text AS mid_micro, status FROM early_samples WHERE early_id = $1 ORDER BY t DESC LIMIT 600`,
    [id],
  );
  const timing = await db.query<{ settled_at: string | null }>("SELECT settled_at::text AS settled_at FROM early_pots WHERE id = $1", [id]);
  return {
    early: dto,
    signatures: signatures.map((s) => ({
      signer: getAddress(s.signer),
      kind: s.kind,
      outcome: s.outcome,
      evidenceHash: s.evidence_hash,
      record: typeof s.record === "string" ? JSON.parse(s.record) : s.record,
      attestation: s.attestation,
      resolution: s.resolution,
      at: s.created_at,
    })),
    recipients: recipients.map((x) => ({ account: getAddress(x.account), seat: Number(x.seat), tx: x.tx_hash, at: x.block_time })),
    payments: payments.map((p) => ({ account: p.account ? getAddress(p.account) : null, amount: p.amount, tx: p.tx_hash, kind: p.event_name })),
    samples: samples.reverse().map((s) => ({ signer: getAddress(s.signer), t: Number(s.t), mid: s.mid_micro === null ? null : Number(s.mid_micro) / 1e6, status: s.status })),
    settledAt: timing[0]?.settled_at ?? null,
    /** The EIP-712 digests the 2-of-3 resolver signs, so anyone can check the signatures. */
    resolutionDigests: r.pot_id
      ? Object.fromEntries(
          [true, false].map((outcome) => [
            String(outcome),
            hashTypedData({ domain: resolutionDomain(getConfig().chainId, getConfig().vault), types: resolutionTypes, primaryType: "Resolution", message: { potId: BigInt(r.pot_id!), conditionId: r.condition_id, outcome } }),
          ]),
        )
      : null,
  };
}
