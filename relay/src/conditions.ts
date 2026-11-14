import { keccak256, stringToBytes, type Hex } from "viem";
import type { Db } from "./db";

export type Condition = { conditionId: Hex; source: string; key: string; label: string | null };

const SOURCE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

/** conditionId = keccak256("<source>:<key>"), so the id cannot be registered under a different meaning. */
export function conditionIdFor(source: string, key: string): Hex {
  return keccak256(stringToBytes(`${source}:${key}`));
}

export async function registerCondition(db: Db, source: string, key: string, label?: string): Promise<Condition> {
  if (!SOURCE_RE.test(source)) throw new Error("invalid source name");
  if (!key || key.length > 200) throw new Error("invalid key");
  const conditionId = conditionIdFor(source, key);
  await db.query(
    `INSERT INTO conditions (condition_id, source, key, label) VALUES ($1, $2, $3, $4)
     ON CONFLICT (condition_id) DO NOTHING`,
    [conditionId, source, key, label ?? null],
  );
  return (await getCondition(db, conditionId))!;
}

export async function getCondition(db: Db, conditionId: Hex): Promise<Condition | undefined> {
  const rows = await db.query<{ condition_id: Hex; source: string; key: string; label: string | null }>(
    "SELECT condition_id, source, key, label FROM conditions WHERE condition_id = $1",
    [conditionId.toLowerCase()],
  );
  const r = rows[0];
  return r && { conditionId: r.condition_id, source: r.source, key: r.key, label: r.label };
}
