import type { Db } from "./db";

/**
 * Rows re-read only when they changed: a tiny fingerprint query (how many rows, newest update) runs
 * every time, the full query only when the fingerprint moved. Every byte read leaves the database
 * (Neon's free plan allows 5 GB a month), and the relay ticks every 5 seconds.
 */
const caches = new WeakMap<Db, Map<string, { fp: string; rows: unknown[] }>>();

export async function rowsWhileUnchanged<T>(db: Db, key: string, fingerprintSql: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const fpRow = (await db.query<{ fp: string }>(fingerprintSql, params))[0];
  const fp = fpRow?.fp ?? "";
  let m = caches.get(db);
  if (!m) caches.set(db, (m = new Map()));
  const hit = m.get(key);
  if (hit && hit.fp === fp) return hit.rows as T[];
  const rows = await db.query<T>(sql, params);
  m.set(key, { fp, rows });
  return rows;
}
