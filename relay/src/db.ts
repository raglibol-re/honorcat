import { getConfig } from "./config";

/** Minimal SQL interface implemented by node-postgres (production) and PGlite (local dev, tests). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS chain_events (
  tx_hash      TEXT    NOT NULL,
  log_index    INTEGER NOT NULL,
  block_number BIGINT  NOT NULL,
  block_time   BIGINT,
  event_name   TEXT    NOT NULL,
  pot_id       BIGINT,
  args         JSONB   NOT NULL,
  source       TEXT    NOT NULL,
  inserted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS chain_events_pot_idx ON chain_events (pot_id, block_number, log_index);
CREATE INDEX IF NOT EXISTS chain_events_block_idx ON chain_events (block_number DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS pots (
  pot_id        BIGINT PRIMARY KEY,
  condition_id  TEXT    NOT NULL,
  creator       TEXT    NOT NULL,
  resolver      TEXT    NOT NULL,
  refund_to     TEXT    NOT NULL,
  deadline      BIGINT  NOT NULL,
  payees        JSONB   NOT NULL,
  shares_bps    JSONB   NOT NULL,
  status        TEXT    NOT NULL,
  outcome       BOOLEAN,
  total         TEXT    NOT NULL,
  funding_count INTEGER NOT NULL,
  created_block BIGINT  NOT NULL,
  created_tx    TEXT    NOT NULL,
  created_time  BIGINT,
  settled_tx    TEXT,
  settled_time  BIGINT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pots_status_idx ON pots (status);

CREATE OR REPLACE VIEW payments AS
SELECT tx_hash, log_index, block_number, block_time, pot_id,
  CASE event_name
    WHEN 'Payout' THEN 'payout'
    WHEN 'Refund' THEN 'refund'
    WHEN 'Claimed' THEN 'claim'
    WHEN 'PaymentDeferred' THEN CASE WHEN (args->>'kind') = '0' THEN 'payout_deferred' ELSE 'refund_deferred' END
  END AS kind,
  COALESCE(args->>'payee', args->>'refundTo', args->>'recipient', args->>'account') AS recipient,
  args->>'amount' AS amount
FROM chain_events
WHERE event_name IN ('Payout', 'Refund', 'PaymentDeferred', 'Claimed');

CREATE TABLE IF NOT EXISTS conditions (
  condition_id TEXT PRIMARY KEY,
  source       TEXT  NOT NULL,
  key          TEXT  NOT NULL,
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS manual_outcomes (
  condition_id TEXT PRIMARY KEY,
  outcome      BOOLEAN NOT NULL,
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS resolutions (
  pot_id     BIGINT PRIMARY KEY,
  action     TEXT    NOT NULL,
  outcome    BOOLEAN,
  tx_hash    TEXT,
  status     TEXT    NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relay_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relay_lease (
  id         INTEGER PRIMARY KEY,
  holder     TEXT,
  until      TIMESTAMPTZ NOT NULL,
  last_start TIMESTAMPTZ NOT NULL
);
INSERT INTO relay_lease (id, holder, until, last_start)
VALUES (1, NULL, to_timestamp(0), to_timestamp(0)) ON CONFLICT (id) DO NOTHING;
`;

type GlobalWithDb = typeof globalThis & { __verdictDb?: Promise<Db> };

/** Returns a process-wide database handle, creating the schema on first use. */
export function getDb(): Promise<Db> {
  const g = globalThis as GlobalWithDb;
  g.__verdictDb ??= open().catch((err) => {
    g.__verdictDb = undefined;
    throw err;
  });
  return g.__verdictDb;
}

async function open(): Promise<Db> {
  const { databaseUrl, pgliteDir } = getConfig();
  const db = databaseUrl ? await openPg(databaseUrl) : await openPglite(pgliteDir);
  await db.exec(SCHEMA);
  return db;
}

async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  // Keep BIGINT as string (avoids precision loss); callers convert explicitly.
  const pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10_000 });
  return {
    async query(sql, params) {
      const res = await pool.query(sql, params as unknown[]);
      return res.rows;
    },
    async exec(sql) {
      await pool.query(sql);
    },
  };
}

export async function openPglite(dir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dir) (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const pg = dir ? new PGlite(dir) : new PGlite();
  return {
    async query<T>(sql: string, params?: unknown[]) {
      const res = await pg.query<T>(sql, params as unknown[]);
      return res.rows;
    },
    async exec(sql) {
      await pg.exec(sql);
    },
  };
}

/** Creates a fresh in-memory database with the schema (tests). */
export async function memoryDb(): Promise<Db> {
  const db = await openPglite();
  await db.exec(SCHEMA);
  return db;
}

export async function getState(db: Db, key: string): Promise<string | undefined> {
  const rows = await db.query<{ value: string }>("SELECT value FROM relay_state WHERE key = $1", [key]);
  return rows[0]?.value;
}

export async function setState(db: Db, key: string, value: string): Promise<void> {
  await db.query(
    "INSERT INTO relay_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [key, value],
  );
}
