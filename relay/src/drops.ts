import { randomBytes } from "node:crypto";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { concat, encodeFunctionData, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { batchGuardAbi, merkleBookAbi, verdictVaultAbi } from "./abi";
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
import { memoCall } from "./memo";
import { sendRelayCalls, type RelayCall } from "./txs";

/**
 * Drops: one pot, thousands of payees (MerkleBook). The pot's only payee is the MerkleBook and its
 * refundTo is the funder; the list of (index, account, amount) lives off-chain and only its Merkle
 * root goes on-chain. If the condition is met the relay pushes the claims in batches through
 * Multicall3From; anyone else can push them too with the public proofs.
 */

export const LEAF_ENCODING = ["uint256", "address", "uint256"] as const;
export const MAX_DROP_ENTRIES = 20_000;
/** Claims per transaction. Each costs ~60-90k gas (proof length 4-15). */
export const CLAIM_BATCH = 120;
/** How long payees have to receive their payout after the last possible resolution. */
export const CLAIM_WINDOW_SECONDS = 30 * 24 * 3600;

export type DropEntry = { account: Address; amount: bigint };

export type DropTerms = {
  name: string;
  funder: Address;
  /** Gemini condition key: EVENT:CONTRACT or EVENT:CONTRACT:no. */
  conditionKey: string;
  conditionLabel: string;
  lockTime: number;
  deadline: number;
  entries: DropEntry[];
  listed?: boolean;
};

export type DropTree = { tree: StandardMerkleTree<[string, string, string]>; root: Hex; total: bigint };

/** OpenZeppelin standard tree: leaf = keccak256(bytes.concat(keccak256(abi.encode(i, account, amount)))). */
export function buildDropTree(entries: DropEntry[]): DropTree {
  if (entries.length === 0) throw new GaslessError("the list is empty");
  if (entries.length > MAX_DROP_ENTRIES) throw new GaslessError(`at most ${MAX_DROP_ENTRIES} entries`);
  let total = 0n;
  const values = entries.map((e, i): [string, string, string] => {
    if (!isAddress(e.account)) throw new GaslessError(`entry ${i}: invalid address`);
    if (e.amount <= 0n) throw new GaslessError(`entry ${i}: amount must be positive`);
    total += e.amount;
    return [i.toString(), getAddress(e.account), e.amount.toString()];
  });
  const tree = StandardMerkleTree.of(values, [...LEAF_ENCODING]);
  return { tree, root: tree.root as Hex, total };
}

function requireMerkle() {
  const m = getConfig().merkle;
  const g = getConfig().guarantees;
  if (!m || !g) throw new GaslessError("Drops are not configured on this deployment", 503);
  return { book: m.book, guard: g.guard };
}

function potParams(t: DropTerms, book: Address): PotParams {
  return {
    conditionId: conditionIdFor("gemini", t.conditionKey),
    resolver: resolverAccount().address,
    payees: [book],
    sharesBps: [10_000],
    refundTo: getAddress(t.funder),
    deadline: BigInt(t.deadline),
  };
}

export function validateDrop(t: DropTerms) {
  const now = Math.floor(Date.now() / 1000);
  if (!t.name.trim() || t.name.length > 80) throw new GaslessError("name is required (max 80 characters)");
  if (!/^[A-Z0-9._-]+:[A-Z0-9._-]+(:no)?$/i.test(t.conditionKey)) throw new GaslessError("conditionKey must be EVENT:CONTRACT[:no]");
  if (t.lockTime <= now + 30) throw new GaslessError("the list must stay editable for at least 30 seconds");
  if (t.lockTime >= t.deadline) throw new GaslessError("the list must lock before the deadline");
}

/** The authorization salt commits to the list: salt = keccak256(root ++ entropy). */
export const dropSalt = (root: Hex, entropy: Hex) => keccak256(concat([root, entropy]));

/**
 * Typed data the funder signs: one EIP-3009 authorization for the list's total. Its salt is
 * derived from the Merkle root, so the signature also approves this exact list; the relay cannot
 * swap it for another one.
 */
export async function prepareDrop(t: DropTerms) {
  validateDrop(t);
  const { book } = requireMerkle();
  const { root, total } = buildDropTree(t.entries);
  const params = potParams(t, book);
  const entropy = randomSalt();
  const prepared = await prepareGasless({ kind: "create", params, from: getAddress(t.funder), amount: total, validForSeconds: 900, salt: dropSalt(root, entropy) });
  return { params, amount: total, root, entropy, prepared };
}

const newId = () => randomBytes(8).toString("base64url").slice(0, 10);

async function claimDeadlineFor(deadline: number): Promise<bigint> {
  const cfg = getConfig();
  const grace = await publicClient().readContract({ address: cfg.vault, abi: verdictVaultAbi, functionName: "gracePeriod" });
  return BigInt(deadline) + grace + BigInt(CLAIM_WINDOW_SECONDS);
}

async function storeEntries(db: Db, id: string, tree: DropTree["tree"], version: number) {
  await db.query("DELETE FROM drop_entries WHERE drop_id = $1", [id]);
  const rows: unknown[][] = [];
  for (const [i, v] of tree.entries()) rows.push([id, Number(v[0]), v[1].toLowerCase(), v[2], JSON.stringify(tree.getProof(i)), version]);
  // Insert in chunks to keep statements small.
  for (let k = 0; k < rows.length; k += 500) {
    const chunk = rows.slice(k, k + 500);
    const params: unknown[] = [];
    const values = chunk.map((r, j) => {
      params.push(...r);
      const b = j * 6;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
    });
    await db.query(`INSERT INTO drop_entries (drop_id, idx, account, amount, proof, version) VALUES ${values.join(",")}`, params);
  }
}

/**
 * Creates a funded drop in ONE atomic transaction:
 *   BatchGuard.expectNextPotId(vault, n)
 *   Memo(vault.createPotWithAuthorization(params, total, funderSig))
 *   MerkleBook.open(n, lockTime, claimDeadline, root, total)
 */
export async function createDrop(db: Db, t: DropTerms, auth: SignedAuthorization, entropy: Hex, integration: string | null = null) {
  validateDrop(t);
  const cfg = getConfig();
  const { book, guard } = requireMerkle();
  const dt = buildDropTree(t.entries);
  const params = potParams(t, book);
  if (getAddress(auth.from) !== getAddress(t.funder)) throw new GaslessError("authorization must come from the funder");
  if (auth.salt.toLowerCase() !== dropSalt(dt.root, entropy).toLowerCase()) throw new GaslessError("the signed authorization is for a different list");
  await checkPolicy(db, auth.from, dt.total, integration ?? "drops");
  await verifySigner(auth, dt.total, createNonce(cfg.chainId, cfg.vault, params, auth.salt));
  await registerCondition(db, "gemini", t.conditionKey, t.conditionLabel);

  const id = newId();
  const ref = `drop-${id}`;
  const claimDeadline = await claimDeadlineFor(t.deadline);
  await db.query(
    `INSERT INTO drops (id, name, funder, condition_key, condition_label, condition_id, lock_time, deadline, claim_deadline, root, root_total, entries, version, listed)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13)`,
    [
      id,
      t.name.trim(),
      getAddress(t.funder).toLowerCase(),
      t.conditionKey,
      t.conditionLabel,
      params.conditionId.toLowerCase(),
      t.lockTime,
      t.deadline,
      claimDeadline.toString(),
      dt.root,
      dt.total.toString(),
      t.entries.length,
      t.listed !== false,
    ],
  );
  await storeEntries(db, id, dt.tree, 1);

  const createData = encodeFunctionData({ abi: verdictVaultAbi, functionName: "createPotWithAuthorization", args: [params, dt.total, toContractAuth(auth)] });
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const potId = (await publicClient().readContract({ address: cfg.vault, abi: verdictVaultAbi, functionName: "potCount" })) + 1n;
    const res = await sendRelayCalls(
      db,
      "drop_create",
      [
        { target: guard, callData: encodeFunctionData({ abi: batchGuardAbi, functionName: "expectNextPotId", args: [cfg.vault, potId] }), label: "guard" },
        {
          ...memoCall(cfg.vault, createData, ref, {
            v: 1,
            t: "fund",
            ref,
            pot: potId.toString(),
            why: `${t.name.trim()} locked ${(Number(dt.total) / 1e6).toFixed(2)} USDC for ${t.entries.length} payees`,
          }),
          potIds: [potId.toString()],
          label: "create",
        },
        {
          target: book,
          callData: encodeFunctionData({ abi: merkleBookAbi, functionName: "open", args: [potId, BigInt(t.lockTime), claimDeadline, dt.root, dt.total] }),
          label: "open",
        },
      ],
      { atomic: true },
    );
    if (res.ok) {
      await db.query("UPDATE drops SET pot_id = $2, created_tx = $3, status = 'live' WHERE id = $1", [id, potId.toString(), res.tx]);
      await syncDropId(db, id);
      await logRequest(db, auth.from, integration ?? "drops", "drop", dt.total, res.tx);
      return { id, potId: potId.toString(), root: dt.root, total: dt.total.toString(), tx: res.tx };
    }
    lastError = res.error;
    if (!/UnexpectedPotId/.test(res.error)) break;
  }
  await db.query("UPDATE drops SET status = 'failed', error = $2 WHERE id = $1", [id, lastError.slice(0, 300)]);
  throw new GaslessError(`could not create the drop: ${lastError}`, 502);
}

async function syncDropId(db: Db, id: string) {
  const r = await db.query<{ pot_id: string | null }>("SELECT pot_id::text AS pot_id FROM drops WHERE id = $1", [id]);
  const potId = r[0]?.pot_id;
  if (!potId) return;
  const { book } = requireMerkle();
  const dropId = await publicClient().readContract({ address: book, abi: merkleBookAbi, functionName: "dropOfPot", args: [BigInt(potId)] });
  if (dropId > 0n) await db.query("UPDATE drops SET drop_id = $2 WHERE id = $1", [id, dropId.toString()]);
}

/**
 * Replaces the list before lockTime (the relay is the MerkleBook operator). The new root must
 * not exceed the pot. Emits RootSet with a new version on-chain.
 */
export async function replaceDropEntries(db: Db, id: string, entries: DropEntry[]) {
  const { book } = requireMerkle();
  const d = (await db.query<{ drop_id: string | null; lock_time: string; version: number }>(
    "SELECT drop_id::text AS drop_id, lock_time::text AS lock_time, version FROM drops WHERE id = $1",
    [id],
  ))[0];
  if (!d?.drop_id) throw new GaslessError("drop not found", 404);
  if (Number(d.lock_time) <= Math.floor(Date.now() / 1000)) throw new GaslessError("the list is locked", 409);
  const dt = buildDropTree(entries);
  const res = await sendRelayCalls(db, "drop_root", [
    { target: book, callData: encodeFunctionData({ abi: merkleBookAbi, functionName: "setRoot", args: [BigInt(d.drop_id), dt.root, dt.total] }), label: "setRoot" },
  ]);
  if (!res.ok) throw new GaslessError(res.dropped[0]?.error ?? res.error, /RootLocked|OverAllocated/.test(res.error + (res.dropped[0]?.error ?? "")) ? 409 : 502);
  const version = d.version + 1;
  await db.query("UPDATE drops SET root = $2, root_total = $3, entries = $4, version = $5 WHERE id = $1", [id, dt.root, dt.total.toString(), entries.length, version]);
  await storeEntries(db, id, dt.tree, version);
  return { id, root: dt.root, total: dt.total.toString(), version, tx: res.tx };
}

// ------------------------------------------------------------------ reads

export type DropDto = {
  id: string;
  dropId: string | null;
  potId: string | null;
  name: string;
  funder: Address;
  conditionKey: string;
  conditionLabel: string;
  lockTime: number;
  deadline: number;
  claimDeadline: number;
  root: Hex;
  rootTotal: string;
  entries: number;
  version: number;
  status: string;
  potStatus: string | null;
  outcome: boolean | null;
  claimed: number;
  claimedAmount: string;
  createdTx: string | null;
  sweptTx: string | null;
};

type DropRow = {
  id: string;
  drop_id: string | null;
  pot_id: string | null;
  name: string;
  funder: string;
  condition_key: string;
  condition_label: string;
  lock_time: string;
  deadline: string;
  claim_deadline: string;
  root: string;
  root_total: string;
  entries: number;
  version: number;
  status: string;
  pot_status: string | null;
  outcome: boolean | null;
  claimed: string;
  claimed_amount: string | null;
  created_tx: string | null;
  swept_tx: string | null;
};

const DROP_SELECT = `
  SELECT d.id, d.drop_id::text AS drop_id, d.pot_id::text AS pot_id, d.name, d.funder, d.condition_key, d.condition_label,
         d.lock_time::text AS lock_time, d.deadline::text AS deadline, d.claim_deadline::text AS claim_deadline,
         d.root, d.root_total::text AS root_total, d.entries, d.version, d.status, p.status AS pot_status, p.outcome,
         (SELECT count(*) FROM drop_entries e WHERE e.drop_id = d.id AND e.claimed_tx IS NOT NULL)::text AS claimed,
         (SELECT sum(amount) FROM drop_entries e WHERE e.drop_id = d.id AND e.claimed_tx IS NOT NULL)::text AS claimed_amount,
         d.created_tx, d.swept_tx
  FROM drops d LEFT JOIN pots p ON p.pot_id = d.pot_id`;

const toDto = (r: DropRow): DropDto => ({
  id: r.id,
  dropId: r.drop_id,
  potId: r.pot_id,
  name: r.name,
  funder: getAddress(r.funder),
  conditionKey: r.condition_key,
  conditionLabel: r.condition_label,
  lockTime: Number(r.lock_time),
  deadline: Number(r.deadline),
  claimDeadline: Number(r.claim_deadline),
  root: r.root as Hex,
  rootTotal: r.root_total,
  entries: r.entries,
  version: r.version,
  status: r.status,
  potStatus: r.pot_status,
  outcome: r.outcome,
  claimed: Number(r.claimed),
  claimedAmount: r.claimed_amount ?? "0",
  createdTx: r.created_tx,
  sweptTx: r.swept_tx,
});

export async function dropDetail(db: Db, id: string): Promise<DropDto | null> {
  const r = await db.query<DropRow>(`${DROP_SELECT} WHERE d.id = $1`, [id]);
  return r[0] ? toDto(r[0]) : null;
}

export async function listDrops(db: Db, opts: { listedOnly?: boolean } = {}): Promise<DropDto[]> {
  const r = await db.query<DropRow>(
    `${DROP_SELECT} WHERE d.status = 'live' ${opts.listedOnly === false ? "" : "AND d.listed"} ORDER BY d.created_at DESC LIMIT 100`,
  );
  return r.map(toDto);
}

export type DropProof = { index: number; account: Address; amount: string; proof: Hex[]; claimedTx: string | null; deferred: boolean };

/** Every entry for `account` in the current list, with its proof and claim status. */
export async function dropProofs(db: Db, id: string, account: Address): Promise<{ drop: DropDto; entries: DropProof[] } | null> {
  const drop = await dropDetail(db, id);
  if (!drop) return null;
  const rows = await db.query<{ idx: number; account: string; amount: string; proof: Hex[] | string; claimed_tx: string | null; deferred: boolean }>(
    "SELECT idx, account, amount::text AS amount, proof, claimed_tx, deferred FROM drop_entries WHERE drop_id = $1 AND account = $2 ORDER BY idx",
    [id, getAddress(account).toLowerCase()],
  );
  return {
    drop,
    entries: rows.map((r) => ({
      index: r.idx,
      account: getAddress(r.account),
      amount: r.amount,
      proof: typeof r.proof === "string" ? (JSON.parse(r.proof) as Hex[]) : r.proof,
      claimedTx: r.claimed_tx,
      deferred: r.deferred,
    })),
  };
}

// ------------------------------------------------------------------ settlement (called from the tick)

export type DropAction = { drop: string; action: "claims" | "sweep"; count?: number; tx?: Hex; result: string };

/**
 * Pushes pending claims for drops whose pot resolved positively, CLAIM_BATCH per transaction
 * through Multicall3From (calls that would fail, e.g. already claimed by someone else, are dropped
 * in simulation). After the claim window, sweeps the rest back to the funder.
 */
export async function processDrops(db: Db, opts: { maxTxs?: number } = {}): Promise<DropAction[]> {
  const m = getConfig().merkle;
  if (!m) return [];
  const out: DropAction[] = [];
  const now = Math.floor(Date.now() / 1000);
  const due = await db.query<{ id: string; drop_id: string; claim_deadline: string; swept_tx: string | null; pot_id: string }>(
    `SELECT d.id, d.drop_id::text AS drop_id, d.claim_deadline::text AS claim_deadline, d.swept_tx, d.pot_id::text AS pot_id
     FROM drops d JOIN pots p ON p.pot_id = d.pot_id
     WHERE d.drop_id IS NOT NULL AND p.status = 'resolved' AND p.outcome = true AND d.swept_tx IS NULL
     ORDER BY d.created_at`,
  );
  let txs = 0;
  const maxTxs = opts.maxTxs ?? 3;
  for (const d of due) {
    if (now > Number(d.claim_deadline)) {
      const res = await sendRelayCalls(db, "drop_sweep", [
        { target: m.book, callData: encodeFunctionData({ abi: merkleBookAbi, functionName: "sweep", args: [BigInt(d.drop_id)] }), potIds: [d.pot_id], label: "sweep" },
      ]);
      const err = res.dropped[0]?.error ?? (res.ok ? null : res.error);
      if (res.ok || err === "AlreadySwept") await db.query("UPDATE drops SET swept_tx = $2 WHERE id = $1", [d.id, res.tx ?? "already"]);
      out.push({ drop: d.id, action: "sweep", tx: res.tx, result: res.ok ? "confirmed" : `error: ${err}` });
      continue;
    }
    while (txs < maxTxs) {
      const pending = await db.query<{ idx: number; account: string; amount: string; proof: Hex[] | string }>(
        `SELECT idx, account, amount::text AS amount, proof FROM drop_entries
         WHERE drop_id = $1 AND claimed_tx IS NULL AND NOT failed ORDER BY idx LIMIT $2`,
        [d.id, CLAIM_BATCH],
      );
      if (pending.length === 0) break;
      const calls: RelayCall[] = pending.map((e) => ({
        target: m.book,
        callData: encodeFunctionData({
          abi: merkleBookAbi,
          functionName: "claim",
          args: [BigInt(d.drop_id), BigInt(e.idx), getAddress(e.account), BigInt(e.amount), typeof e.proof === "string" ? (JSON.parse(e.proof) as Hex[]) : e.proof],
        }),
        potIds: [d.pot_id],
        label: `claim ${e.idx}`,
      }));
      txs++;
      const res = await sendRelayCalls(db, "drop_claims", calls);
      const dropped = new Map(res.dropped.map((x) => [x.call.label, x.error]));
      for (const e of pending) {
        const err = dropped.get(`claim ${e.idx}`);
        if (err === "AlreadyClaimed") await db.query("UPDATE drop_entries SET claimed_tx = 'external' WHERE drop_id = $1 AND idx = $2", [d.id, e.idx]);
        else if (err) await db.query("UPDATE drop_entries SET failed = true, error = $3 WHERE drop_id = $1 AND idx = $2", [d.id, e.idx, err]);
        else if (res.ok) await db.query("UPDATE drop_entries SET claimed_tx = $3 WHERE drop_id = $1 AND idx = $2", [d.id, e.idx, res.tx]);
      }
      out.push({ drop: d.id, action: "claims", count: pending.length - res.dropped.length, tx: res.ok ? res.tx : undefined, result: res.ok ? "confirmed" : `error: ${res.error}` });
      if (!res.ok) break;
    }
  }
  return out;
}

/** Marks entries paid from indexed MerkleBook events (claims pushed by anyone). */
export async function applyMerkleEvent(db: Db, eventName: string, args: Record<string, unknown>, tx: string) {
  if (eventName !== "Claimed" && eventName !== "ClaimDeferred") return;
  const dropId = String(args.dropId);
  const index = String(args.index);
  if (index === (2n ** 256n - 1n).toString()) return; // sweep deferral
  await db.query(
    `UPDATE drop_entries e SET claimed_tx = COALESCE(NULLIF(e.claimed_tx, 'external'), $3), deferred = $4
     FROM drops d WHERE d.id = e.drop_id AND d.drop_id = $1 AND e.idx = $2`,
    [dropId, Number(index), tx, eventName === "ClaimDeferred"],
  );
}
