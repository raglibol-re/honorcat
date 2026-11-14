import type { Hex } from "viem";
import { verdictVaultAbi } from "./abi";
import { publicClient, resolverAccount } from "./chain";
import { getCondition } from "./conditions";
import { getConfig } from "./config";
import type { Db } from "./db";
import { signResolution } from "./signer";
import type { ResultSource } from "./sources/types";
import { sendVaultTx } from "./txs";

const MAX_ATTEMPTS = 5;

type OpenPot = { pot_id: string; condition_id: Hex; deadline: string };

export type ActionReport = { potId: string; action: "resolve" | "expire"; outcome?: boolean; tx?: Hex; result: string };

let graceCache: bigint | undefined;
async function gracePeriod(): Promise<bigint> {
  graceCache ??= await publicClient().readContract({
    address: getConfig().vault,
    abi: verdictVaultAbi,
    functionName: "gracePeriod",
  });
  return graceCache;
}

async function record(
  db: Db,
  potId: string,
  action: string,
  fields: { outcome?: boolean | null; tx?: string | null; status: string; error?: string | null; attempt?: boolean },
) {
  await db.query(
    `INSERT INTO resolutions (pot_id, action, outcome, tx_hash, status, attempts, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (pot_id) DO UPDATE SET action = EXCLUDED.action, outcome = EXCLUDED.outcome,
       tx_hash = COALESCE(EXCLUDED.tx_hash, resolutions.tx_hash), status = EXCLUDED.status,
       attempts = resolutions.attempts + $6, last_error = EXCLUDED.last_error, updated_at = now()`,
    [potId, action, fields.outcome ?? null, fields.tx ?? null, fields.status, fields.attempt ? 1 : 0, fields.error ?? null],
  );
}

async function attempts(db: Db, potId: string): Promise<number> {
  const rows = await db.query<{ attempts: number }>("SELECT attempts FROM resolutions WHERE pot_id = $1", [potId]);
  return rows[0]?.attempts ?? 0;
}

/** Sends one resolve/expire through the shared transaction path and records the outcome. */
async function submit(
  db: Db,
  potId: string,
  action: "resolve" | "expire",
  args: readonly unknown[],
  outcome?: boolean,
): Promise<ActionReport> {
  const res = await sendVaultTx(db, action, action, args, potId);
  if (res.ok) {
    await record(db, potId, action, { outcome, tx: res.tx, status: "confirmed", attempt: true });
    return { potId, action, outcome, tx: res.tx, result: "confirmed" };
  }
  if (res.revert === "PotNotOpen") {
    // Settled by someone else (or by an earlier attempt we lost track of); the indexer catches up.
    await record(db, potId, action, { outcome, status: "already_settled" });
    return { potId, action, outcome, result: "already_settled" };
  }
  await record(db, potId, action, { outcome, tx: res.tx, status: "error", error: res.error, attempt: true });
  return { potId, action, outcome, tx: res.tx, result: `error: ${res.error}` };
}

/**
 * For every open, funded pot that this relay resolves: ask its source for the outcome and,
 * once known, sign and submit `resolve`. Pots past `deadline + grace` are expired instead.
 */
export async function processOpenPots(db: Db, sources: Record<string, ResultSource>): Promise<ActionReport[]> {
  const cfg = getConfig();
  const me = resolverAccount().address.toLowerCase();
  const grace = await gracePeriod();
  const now = BigInt(Math.floor(Date.now() / 1000));

  const pots = await db.query<OpenPot>(
    `SELECT p.pot_id::text AS pot_id, p.condition_id, p.deadline::text AS deadline
     FROM pots p LEFT JOIN resolutions r ON r.pot_id = p.pot_id
     WHERE p.status = 'open' AND lower(p.resolver) = $1
       AND (r.status IS NULL OR r.status NOT IN ('confirmed', 'already_settled'))
     ORDER BY p.pot_id`,
    [me],
  );

  const reports: ActionReport[] = [];
  for (const pot of pots) {
    if ((await attempts(db, pot.pot_id)) >= MAX_ATTEMPTS) continue;
    const closesAt = BigInt(pot.deadline) + grace;

    if (now > closesAt) {
      if (cfg.autoExpire) reports.push(await submit(db, pot.pot_id, "expire", [BigInt(pot.pot_id)]));
      continue;
    }

    const condition = await getCondition(db, pot.condition_id);
    if (!condition) continue; // not a condition this relay knows about
    const source = sources[condition.source];
    if (!source) continue;

    let outcome: boolean | null;
    try {
      outcome = await source.getOutcome(pot.condition_id);
    } catch (err) {
      reports.push({ potId: pot.pot_id, action: "resolve", result: `source error: ${(err as Error).message}` });
      continue;
    }
    if (outcome === null) continue;

    const funded = await db.query<{ total: string }>("SELECT total FROM pots WHERE pot_id = $1", [pot.pot_id]);
    if (funded[0]?.total === "0") continue; // contract rejects unfunded pots; wait for funding or expiry

    const signature = await signResolution(resolverAccount(), {
      chainId: cfg.chainId,
      vault: cfg.vault,
      potId: BigInt(pot.pot_id),
      conditionId: pot.condition_id,
      outcome,
    });
    reports.push(await submit(db, pot.pot_id, "resolve", [BigInt(pot.pot_id), outcome, signature], outcome));
  }
  return reports;
}
