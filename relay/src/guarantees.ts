import { randomBytes } from "node:crypto";
import {
  encodeFunctionData,
  getAddress,
  parseAbi,
  parseSignature,
  recoverTypedDataAddress,
  verifyMessage,
  type Address,
  type Hex,
} from "viem";
import { batchGuardAbi, guaranteeBookAbi, verdictVaultAbi } from "./abi";
import { ARC_USDC, usdcDomain } from "./arc";
import { publicClient, resolverAccount } from "./chain";
import { conditionIdFor, registerCondition } from "./conditions";
import { getConfig } from "./config";
import type { Db } from "./db";
import {
  checkPolicy,
  createNonce,
  GaslessError,
  logRequest,
  prepareGasless,
  randomSalt,
  toContractAuth,
  verifySigner,
  type PotParams,
  type SignedAuthorization,
} from "./gasless";
import { memoCall, memoIdFor } from "./memo";
import { verifyPasskeyJoin, type WebAuthnAssertion } from "./passkeys";
import { sendRelayCalls } from "./txs";

/**
 * Verdict Guarantees: a merchant promises customers a refund if a Gemini market settles a given
 * way. On-chain shape (no vault change): one VerdictVault pot whose only payee is the
 * GuaranteeBook and whose refundTo is the merchant, plus a GuaranteeBook entry with the refund per
 * customer, the seat cap and the enrolment lock time.
 */

export const TEMPLATES = ["rate", "temperature", "price", "demo"] as const;
export type Template = (typeof TEMPLATES)[number];

export type GuaranteeTerms = {
  template: Template;
  merchantName: string;
  merchant: Address;
  eventTicker: string;
  contractTicker: string;
  side: "yes" | "no";
  eventTitle: string;
  contractLabel: string;
  promise: string;
  refund: bigint; // per customer, 6-dp USDC
  maxCustomers: number;
  lockTime: number; // unix seconds, enrolment closes
  settlesAt: number; // market expiry
  deadline: number; // pot deadline (resolution allowed until deadline + grace)
  /** false for test runs: on-chain and provable, but not shown in product lists. */
  listed?: boolean;
};

const MAX_SEATS = 50;

function requireBook() {
  const g = getConfig().guarantees;
  if (!g) throw new GaslessError("Guarantees are not configured on this deployment", 503);
  return g;
}

export function conditionKeyFor(t: Pick<GuaranteeTerms, "eventTicker" | "contractTicker" | "side">) {
  return `${t.eventTicker}:${t.contractTicker}${t.side === "no" ? ":no" : ""}`;
}

export function validateTerms(t: GuaranteeTerms) {
  const now = Math.floor(Date.now() / 1000);
  if (!t.merchantName.trim() || t.merchantName.length > 60) throw new GaslessError("merchant name is required (max 60 characters)");
  if (t.refund < 10_000n) throw new GaslessError("refund per customer must be at least 0.01 USDC");
  if (t.maxCustomers < 1 || t.maxCustomers > MAX_SEATS) throw new GaslessError(`between 1 and ${MAX_SEATS} customers`);
  if (t.lockTime <= now + 30) throw new GaslessError("enrolment must stay open for at least 30 seconds");
  if (t.lockTime > t.settlesAt) throw new GaslessError("enrolment must close before the market settles");
  if (t.deadline <= t.settlesAt) throw new GaslessError("pot deadline must be after the market settles");
}

function potParams(t: GuaranteeTerms, book: Address): PotParams {
  return {
    conditionId: conditionIdFor("gemini", conditionKeyFor(t)),
    resolver: resolverAccount().address,
    payees: [book],
    sharesBps: [10_000],
    refundTo: getAddress(t.merchant),
    deadline: BigInt(t.deadline),
  };
}

/** Typed data the merchant signs: one EIP-3009 authorization covering every seat. */
export async function prepareGuarantee(t: GuaranteeTerms) {
  validateTerms(t);
  const { book } = requireBook();
  const params = potParams(t, book);
  const amount = t.refund * BigInt(t.maxCustomers);
  const prepared = await prepareGasless({ kind: "create", params, from: getAddress(t.merchant), amount, validForSeconds: 900 });
  return { params, amount, prepared };
}

function newId() {
  // 10 url-safe characters; unguessable enough for share links, not a secret.
  return randomBytes(8).toString("base64url").slice(0, 10);
}

/**
 * Creates a funded, open guarantee in ONE transaction through Arc's Multicall3From (all-or-nothing):
 *   BatchGuard.expectNextPotId(vault, n)
 *   Memo.memo(vault, createPotWithAuthorization(params, amount, merchantSig), ref, {fund…})
 *   GuaranteeBook.open(n, refund, maxCustomers, lockTime)
 * The merchant only signs; the relay pays gas. If another pot takes id n first, the guard reverts
 * the whole batch and we retry with n + 1 (the signature commits to terms, not to the id).
 */
export async function createGuarantee(db: Db, t: GuaranteeTerms, auth: SignedAuthorization, integration: string | null = null) {
  validateTerms(t);
  const cfg = getConfig();
  const { book, guard } = requireBook();
  const params = potParams(t, book);
  const amount = t.refund * BigInt(t.maxCustomers);
  if (getAddress(auth.from) !== getAddress(t.merchant)) throw new GaslessError("authorization must come from the merchant");
  await checkPolicy(db, auth.from, amount, integration ?? "guarantees");
  await verifySigner(auth, amount, createNonce(cfg.chainId, cfg.vault, params, auth.salt));

  const key = conditionKeyFor(t);
  await registerCondition(db, "gemini", key, `${t.eventTitle} — ${t.contractLabel}${t.side === "no" ? " (settles No)" : ""}`);

  const id = newId();
  const ref = `guarantee-${id}`;
  await db.query(
    `INSERT INTO guarantees (id, template, merchant_name, merchant, event_ticker, contract_ticker, side, event_title, contract_label,
       promise, refund, max_customers, lock_time, settles_at, deadline, condition_id, listed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [
      id,
      t.template,
      t.merchantName.trim(),
      getAddress(t.merchant).toLowerCase(),
      t.eventTicker,
      t.contractTicker,
      t.side,
      t.eventTitle,
      t.contractLabel,
      t.promise,
      t.refund.toString(),
      t.maxCustomers,
      t.lockTime,
      t.settlesAt,
      t.deadline,
      params.conditionId.toLowerCase(),
      t.listed !== false,
    ],
  );

  const createData = encodeFunctionData({
    abi: verdictVaultAbi,
    functionName: "createPotWithAuthorization",
    args: [params, amount, toContractAuth(auth)],
  });
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const count = await publicClient().readContract({ address: cfg.vault, abi: verdictVaultAbi, functionName: "potCount" });
    const potId = count + 1n;
    await db.query("UPDATE guarantees SET pot_id = $2 WHERE id = $1", [id, potId.toString()]);
    const res = await sendRelayCalls(
      db,
      "guarantee_create",
      [
        { target: guard, callData: encodeFunctionData({ abi: batchGuardAbi, functionName: "expectNextPotId", args: [cfg.vault, potId] }), label: "guard" },
        {
          ...memoCall(cfg.vault, createData, ref, {
            v: 1,
            t: "fund",
            ref,
            pot: potId.toString(),
            why: `${t.merchantName.trim()} locked ${(Number(amount) / 1e6).toFixed(2)} USDC for up to ${t.maxCustomers} refunds of ${(Number(t.refund) / 1e6).toFixed(2)} USDC`,
          }),
          potIds: [potId.toString()],
          label: "create",
        },
        {
          target: book,
          callData: encodeFunctionData({
            abi: guaranteeBookAbi,
            functionName: "open",
            args: [potId, t.refund, t.maxCustomers, BigInt(t.lockTime)],
          }),
          label: "open",
        },
      ],
      { atomic: true },
    );
    if (res.ok) {
      await db.query("UPDATE guarantees SET created_tx = $2, status = 'live' WHERE id = $1", [id, res.tx]);
      await logRequest(db, auth.from, integration ?? "guarantees", "guarantee", amount, res.tx);
      return { id, potId: potId.toString(), tx: res.tx };
    }
    lastError = res.error;
    if (!/UnexpectedPotId/.test(res.error)) break;
  }
  await db.query("UPDATE guarantees SET status = 'failed', error = $2, pot_id = NULL WHERE id = $1", [id, lastError.slice(0, 300)]);
  throw new GaslessError(`could not create the guarantee: ${lastError}`, 502);
}

export const joinMessage = (id: string, account: Address) => `Join Verdict guarantee ${id} as ${getAddress(account)}`;

export type JoinProof = { kind: "eoa"; signature: Hex } | { kind: "passkey"; assertion: WebAuthnAssertion };

/**
 * Enrols a customer who proved control of `account` over joinMessage: an EOA signature (device
 * key, browser wallet) or a passkey assertion over keccak256(joinMessage) for a passkey account.
 * The relay pays gas.
 */
export async function joinGuarantee(db: Db, id: string, account: Address, proof: JoinProof | Hex) {
  const p: JoinProof = typeof proof === "string" ? { kind: "eoa", signature: proof } : proof;
  const { book } = requireBook();
  const rows = await db.query<{ gid: string | null; lock_time: string; max_customers: number; status: string }>(
    "SELECT gid::text AS gid, lock_time::text AS lock_time, max_customers, status FROM guarantees WHERE id = $1",
    [id],
  );
  const g = rows[0];
  if (!g || !g.gid) throw new GaslessError("guarantee not found or not open yet", 404);
  if (Number(g.lock_time) <= Math.floor(Date.now() / 1000)) throw new GaslessError("enrolment has closed", 409);
  if (p.kind === "eoa") {
    const ok = await verifyMessage({ address: getAddress(account), message: joinMessage(id, account), signature: p.signature });
    if (!ok) throw new GaslessError("signature does not match the account", 401);
  } else {
    await verifyPasskeyJoin(db, getAddress(account), joinMessage(id, account), p.assertion);
  }
  const already = await db.query(
    `SELECT 1 FROM chain_events WHERE contract = 'book' AND event_name = 'Enrolled' AND gid = $1 AND args->>'account' = $2`,
    [g.gid, account.toLowerCase()],
  );
  if (already.length) return { id, account, alreadyEnrolled: true };
  const res = await sendRelayCalls(db, "guarantee_enrol", [
    {
      target: book,
      callData: encodeFunctionData({ abi: guaranteeBookAbi, functionName: "enrol", args: [BigInt(g.gid), getAddress(account)] }),
      label: "enrol",
    },
  ]);
  if (!res.ok) {
    const e = res.dropped[0]?.error ?? res.error;
    const status = /EnrolmentClosed|Full|NotCovered|AlreadyEnrolled/.test(e) ? 409 : 502;
    throw new GaslessError(
      e === "Full" ? "this guarantee is full" : e === "EnrolmentClosed" ? "enrolment has closed" : e === "AlreadyEnrolled" ? "already enrolled" : e,
      status,
    );
  }
  return { id, account, tx: res.tx };
}

// ------------------------------------------------------------------ gasless withdraw (EIP-3009)

const transferWithAuthorizationTypes = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const usdc3009Abi = parseAbi([
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

/** Typed data for moving a customer's USDC to any address without gas (Arc USDC EIP-3009). */
export async function prepareWithdraw(from: Address, to: Address, value: bigint) {
  const cfg = getConfig();
  const domain = await usdcDomain(publicClient(), cfg.chainId);
  const nonce = randomSalt();
  const validBefore = BigInt(Math.floor(Date.now() / 1000) + 600);
  return {
    nonce,
    validAfter: "0",
    validBefore: validBefore.toString(),
    typedData: {
      domain,
      types: transferWithAuthorizationTypes,
      primaryType: "TransferWithAuthorization" as const,
      message: { from: getAddress(from), to: getAddress(to), value, validAfter: 0n, validBefore, nonce },
    },
  };
}

/** Only enrolled customers may use the relay for withdrawals, at most 5 per day. */
export async function submitWithdraw(
  db: Db,
  w: { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex; signature: Hex; guaranteeId?: string },
) {
  if (w.value <= 0n) throw new GaslessError("amount must be positive");
  const enrolled = await db.query(
    `SELECT 1 FROM chain_events WHERE contract = 'book' AND event_name = 'Enrolled' AND args->>'account' = $1 LIMIT 1`,
    [w.from.toLowerCase()],
  );
  if (!enrolled.length) throw new GaslessError("only enrolled customers can withdraw through the relay", 403);
  const recent = await db.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM gasless_requests WHERE funder = $1 AND kind = 'withdraw' AND created_at > now() - interval '1 day'`,
    [w.from.toLowerCase()],
  );
  if (Number(recent[0]?.n ?? 0) >= 5) throw new GaslessError("withdrawal limit reached for today", 429);

  const cfg = getConfig();
  const domain = await usdcDomain(publicClient(), cfg.chainId);
  const signer = await recoverTypedDataAddress({
    domain,
    types: transferWithAuthorizationTypes,
    primaryType: "TransferWithAuthorization",
    message: { from: w.from, to: w.to, value: w.value, validAfter: w.validAfter, validBefore: w.validBefore, nonce: w.nonce },
    signature: w.signature,
  });
  if (getAddress(signer) !== getAddress(w.from)) throw new GaslessError("signature does not match `from`", 401);

  const sig = parseSignature(w.signature);
  const v = sig.v !== undefined ? Number(sig.v) : 27 + (sig.yParity ?? 0);
  const data = encodeFunctionData({
    abi: usdc3009Abi,
    functionName: "transferWithAuthorization",
    args: [getAddress(w.from), getAddress(w.to), w.value, w.validAfter, w.validBefore, w.nonce, v, sig.r, sig.s],
  });
  const ref = w.guaranteeId ? `guarantee-${w.guaranteeId}` : "withdraw";
  const res = await sendRelayCalls(
    db,
    "withdraw",
    [{ ...memoCall(ARC_USDC, data, ref, { v: 1, t: "withdraw", ref, why: "Customer withdrew a refund without gas" }), label: "withdraw" }],
    { memoTxsOf: true },
  );
  await logRequest(db, w.from, null, "withdraw", w.value, res.tx);
  if (!res.ok) throw new GaslessError(`withdrawal failed: ${res.dropped[0]?.error ?? res.error}`, 502);
  return { tx: res.tx };
}

// ------------------------------------------------------------------ reads

type Row = {
  id: string;
  gid: string | null;
  pot_id: string | null;
  template: Template;
  merchant_name: string;
  merchant: string;
  event_ticker: string;
  contract_ticker: string;
  side: "yes" | "no";
  event_title: string;
  contract_label: string;
  promise: string;
  refund: string;
  max_customers: number;
  lock_time: string;
  settles_at: string;
  deadline: string;
  condition_id: string;
  created_tx: string | null;
  status: string;
  error: string | null;
  created_at: string;
};

const COLS = `id, gid::text AS gid, pot_id::text AS pot_id, template, merchant_name, merchant, event_ticker, contract_ticker,
  side, event_title, contract_label, promise, refund::text AS refund, max_customers, lock_time::text AS lock_time,
  settles_at::text AS settles_at, deadline::text AS deadline, condition_id, created_tx, status, error, created_at`;

const COLS_G = `g.id, g.gid::text AS gid, g.pot_id::text AS pot_id, g.template, g.merchant_name, g.merchant, g.event_ticker,
  g.contract_ticker, g.side, g.event_title, g.contract_label, g.promise, g.refund::text AS refund, g.max_customers,
  g.lock_time::text AS lock_time, g.settles_at::text AS settles_at, g.deadline::text AS deadline, g.condition_id,
  g.created_tx, g.status, g.error, g.created_at`;

function toDto(r: Row) {
  return {
    id: r.id,
    gid: r.gid ? Number(r.gid) : null,
    potId: r.pot_id ? Number(r.pot_id) : null,
    template: r.template,
    merchantName: r.merchant_name,
    merchant: r.merchant,
    eventTicker: r.event_ticker,
    contractTicker: r.contract_ticker,
    side: r.side,
    eventTitle: r.event_title,
    contractLabel: r.contract_label,
    promise: r.promise,
    refund: r.refund,
    maxCustomers: r.max_customers,
    lockTime: Number(r.lock_time),
    settlesAt: Number(r.settles_at),
    deadline: Number(r.deadline),
    conditionId: r.condition_id,
    createdTx: r.created_tx,
    status: r.status,
    error: r.error,
    createdAt: new Date(r.created_at).toISOString(),
  };
}
export type GuaranteeDto = ReturnType<typeof toDto>;

export async function listGuarantees(db: Db) {
  const rows = await db.query<Row & { enrolled: string; pot_status: string | null; outcome: boolean | null; total: string | null }>(
    `SELECT ${COLS_G},
       (SELECT count(*) FROM chain_events e WHERE e.contract = 'book' AND e.event_name = 'Enrolled' AND e.gid = g.gid)::text AS enrolled,
       p.status AS pot_status, p.outcome, p.total
     FROM guarantees g LEFT JOIN vault_pots p ON p.pot_id = g.pot_id
     WHERE g.status <> 'failed' AND g.listed ORDER BY g.created_at DESC LIMIT 200`,
  );
  return rows.map((r) => ({ ...toDto(r), enrolled: Number(r.enrolled), potStatus: r.pot_status, outcome: r.outcome, lockedTotal: r.total }));
}

type EventRow = {
  tx_hash: string;
  log_index: number;
  block_number: string;
  block_time: string | null;
  event_name: string;
  contract: string;
  args: Record<string, unknown>;
  source: string;
};

/** Everything the guarantee, card, proof and under-the-hood views need, in one read. */
export async function guaranteeDetail(db: Db, id: string) {
  const rows = await db.query<Row>(`SELECT ${COLS} FROM guarantees WHERE id = $1`, [id]);
  const g = rows[0];
  if (!g) return null;
  const cfg = getConfig();
  const potId = g.pot_id;
  const events = potId
    ? await db.query<EventRow>(
        `SELECT tx_hash, log_index, block_number::text AS block_number, block_time::text AS block_time, event_name, contract, args, source
         FROM chain_events WHERE pot_id = $1 ORDER BY block_number, log_index`,
        [potId],
      )
    : [];
  const pot = potId
    ? (await db.query<{ status: string; outcome: boolean | null; total: string; settled_tx: string | null }>(
        "SELECT status, outcome, total, settled_tx FROM vault_pots WHERE pot_id = $1",
        [potId],
      ))[0] ?? null
    : null;
  const memos = await db.query<{ tx_hash: string; log_index: number; memo_text: string | null; memo_id: string; block_number: string; block_time: string | null; target: string }>(
    `SELECT m.tx_hash, m.log_index, m.memo_text, m.memo_id, m.block_number::text AS block_number, m.block_time::text AS block_time, m.target
     FROM memos m
     WHERE m.memo_id = $2
        OR EXISTS (SELECT 1 FROM chain_events e WHERE e.tx_hash = m.tx_hash AND e.pot_id = $1
                   AND e.log_index > COALESCE(m.before_log_index, -1) AND e.log_index < m.log_index)
     ORDER BY m.block_number, m.log_index`,
    [potId ?? -1, memoIdFor(`guarantee-${id}`).toLowerCase()],
  );
  const resolution = potId
    ? (await db.query<{ action: string; outcome: boolean | null; tx_hash: string | null; status: string; signature: string | null; digest: string | null; reason: string | null; outcome_seen_at: string | null }>(
        "SELECT action, outcome, tx_hash, status, signature, digest, reason, outcome_seen_at FROM resolutions WHERE pot_id = $1",
        [potId],
      ))[0] ?? null
    : null;
  const txs = potId
    ? await db.query<{ tx_hash: string; kind: string; latency_ms: number | null; fee_wei: string | null; confirmed_at: string | null; block_number: string | null }>(
        `SELECT t.tx_hash, t.kind, t.latency_ms, t.fee_wei::text AS fee_wei, t.confirmed_at, t.block_number::text AS block_number
         FROM relay_txs t JOIN relay_tx_pots x ON x.tx_hash = t.tx_hash WHERE x.pot_id = $1 ORDER BY t.submitted_at`,
        [potId],
      )
    : [];

  const ev = events.map((e) => ({
    txHash: e.tx_hash,
    logIndex: e.log_index,
    block: Number(e.block_number),
    time: e.block_time ? Number(e.block_time) : null,
    name: e.event_name,
    contract: e.contract,
    args: e.args,
    firstSeenVia: e.source,
  }));
  const customers = ev
    .filter((e) => e.contract === "book" && e.name === "Enrolled")
    .map((e) => {
      const account = String(e.args.account);
      const paid = ev.find((x) => x.contract === "book" && (x.name === "RefundPaid" || x.name === "RefundDeferred") && String(x.args.account) === account);
      return { account, seat: Number(e.args.seat), enrolled: { tx: e.txHash, block: e.block, time: e.time }, refund: paid ? { tx: paid.txHash, block: paid.block, time: paid.time, deferred: paid.name === "RefundDeferred" } : null };
    });

  // Verdict moment: result seen by the relay -> resolution signed and verified on-chain -> refunds paid.
  const resolved = ev.find((e) => e.name === "PotResolved" || e.name === "PotExpired");
  const firstRefund = ev.find((e) => e.name === "RefundPaid");
  const settleTx = txs.find((t) => t.tx_hash === resolved?.txHash);
  const seenAt = resolution?.outcome_seen_at ? new Date(resolution.outcome_seen_at).getTime() : null;
  const verdict = resolved
    ? {
        resultSeenAt: seenAt,
        resolvedTx: resolved.txHash,
        resolvedBlock: resolved.block,
        resolvedTime: resolved.time,
        refundTx: firstRefund?.txHash ?? null,
        refundBlock: firstRefund?.block ?? null,
        confirmedAt: settleTx?.confirmed_at ? new Date(settleTx.confirmed_at).getTime() : null,
        resultToPaymentMs: seenAt && settleTx?.confirmed_at ? new Date(settleTx.confirmed_at).getTime() - seenAt : null,
        broadcastToReceiptMs: settleTx?.latency_ms ?? null,
      }
    : null;

  return {
    guarantee: toDto(g),
    chain: { chainId: cfg.chainId, vault: cfg.vault, book: cfg.guarantees?.book ?? null, resolver: resolverAccount().address, usdc: ARC_USDC },
    pot,
    events: ev,
    customers,
    memos: memos.map((m) => ({
      txHash: m.tx_hash,
      logIndex: m.log_index,
      block: Number(m.block_number),
      time: m.block_time ? Number(m.block_time) : null,
      target: m.target,
      memoId: m.memo_id,
      text: m.memo_text,
      body: (() => {
        try {
          return m.memo_text ? (JSON.parse(m.memo_text) as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      })(),
    })),
    resolution: resolution && {
      action: resolution.action,
      outcome: resolution.outcome,
      tx: resolution.tx_hash,
      status: resolution.status,
      signature: resolution.signature,
      digest: resolution.digest,
      reason: resolution.reason,
      signedPayload: resolution.signature
        ? {
            domain: { name: "VerdictVault", version: "1", chainId: cfg.chainId, verifyingContract: cfg.vault },
            primaryType: "Resolution",
            message: { potId: potId, conditionId: g.condition_id, outcome: resolution.outcome },
            signer: resolverAccount().address,
            signature: resolution.signature,
            digest: resolution.digest,
          }
        : null,
    },
    relayTxs: txs.map((t) => ({ txHash: t.tx_hash, kind: t.kind, latencyMs: t.latency_ms, feeWei: t.fee_wei, block: t.block_number ? Number(t.block_number) : null })),
    verdict,
  };
}
export type GuaranteeDetail = NonNullable<Awaited<ReturnType<typeof guaranteeDetail>>>;

/** Guarantees an account has joined (from on-chain Enrolled events), newest first. */
export async function accountGuarantees(db: Db, account: Address) {
  const rows = await db.query<Row & { seat: string; pot_status: string | null; outcome: boolean | null }>(
    `SELECT ${COLS_G}, (e.args->>'seat') AS seat, p.status AS pot_status, p.outcome
     FROM chain_events e
     JOIN guarantees g ON g.gid = e.gid
     LEFT JOIN vault_pots p ON p.pot_id = g.pot_id
     WHERE e.contract = 'book' AND e.event_name = 'Enrolled' AND e.args->>'account' = $1
     ORDER BY e.block_number DESC`,
    [account.toLowerCase()],
  );
  return rows.map((r) => ({ ...toDto(r), seat: Number(r.seat), potStatus: r.pot_status, outcome: r.outcome }));
}
