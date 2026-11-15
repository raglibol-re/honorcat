import { getConfig } from "./config";

/** Minimal SQL interface implemented by node-postgres (production) and PGlite (local dev, tests). */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
}

/**
 * Startup migrations, idempotent, run before SCHEMA.
 * 001 (2026-11-16, cleanup C1): the retired vault's table `pots` becomes `vault_pots`, so the name is
 * free for the two-sided pots. Rollback: relay/scripts/migrations/001-vault-pots.down.sql.
 */
export const MIGRATIONS = /* sql */ `
DO $$ BEGIN
  IF to_regclass('public.pots') IS NOT NULL AND to_regclass('public.vault_pots') IS NULL THEN
    ALTER TABLE pots RENAME TO vault_pots;
    ALTER INDEX IF EXISTS pots_status_idx RENAME TO vault_pots_status_idx;
  END IF;
END $$;
`;

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

CREATE TABLE IF NOT EXISTS vault_pots (
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
CREATE INDEX IF NOT EXISTS vault_pots_status_idx ON vault_pots (status);

-- Book (GuaranteeBook) events share chain_events; contract tells them apart.
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS contract TEXT NOT NULL DEFAULT 'vault';
ALTER TABLE chain_events ADD COLUMN IF NOT EXISTS gid BIGINT;
CREATE INDEX IF NOT EXISTS chain_events_gid_idx ON chain_events (gid);
CREATE INDEX IF NOT EXISTS chain_events_tx_idx ON chain_events (tx_hash);

DROP VIEW IF EXISTS payments;
CREATE OR REPLACE VIEW payments AS
SELECT tx_hash, log_index, block_number, block_time, pot_id,
  CASE
    WHEN contract = 'book' AND event_name = 'RefundPaid' THEN 'guarantee_refund'
    WHEN contract = 'book' AND event_name = 'RefundDeferred' THEN 'guarantee_deferred'
    WHEN contract = 'book' AND event_name = 'LeftoverReturned' THEN 'guarantee_leftover'
    WHEN contract = 'book' AND event_name = 'Claimed' THEN 'guarantee_claim'
    WHEN event_name = 'Payout' THEN 'payout'
    WHEN event_name = 'Refund' THEN 'refund'
    WHEN event_name = 'Claimed' THEN 'claim'
    WHEN event_name = 'PaymentDeferred' THEN CASE WHEN (args->>'kind') = '0' THEN 'payout_deferred' ELSE 'refund_deferred' END
  END AS kind,
  COALESCE(args->>'payee', args->>'refundTo', args->>'recipient', args->>'account', args->>'merchant') AS recipient,
  args->>'amount' AS amount,
  contract,
  gid
FROM chain_events
WHERE event_name IN ('Payout', 'Refund', 'PaymentDeferred', 'Claimed', 'RefundPaid', 'RefundDeferred', 'LeftoverReturned');

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

-- Every transaction the relay sends. On Arc gas is paid in USDC, so fee_wei (18-decimal native
-- USDC) is the relay's USDC cost; fee_wei / 1e12 is the same amount in 6-decimal ERC-20 units.
CREATE TABLE IF NOT EXISTS relay_txs (
  tx_hash             TEXT PRIMARY KEY,
  kind                TEXT    NOT NULL,           -- resolve | expire | fund_gasless | create_gasless
  pot_id              BIGINT,
  status              TEXT    NOT NULL,           -- submitted | confirmed | reverted
  gas_used            NUMERIC(78,0),
  effective_gas_price NUMERIC(78,0),
  fee_wei             NUMERIC(78,0),
  block_number        BIGINT,
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ,
  latency_ms          INTEGER
);
CREATE INDEX IF NOT EXISTS relay_txs_pot_idx ON relay_txs (pot_id);

CREATE TABLE IF NOT EXISTS integrations (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  key_hash       TEXT NOT NULL UNIQUE,
  webhook_url    TEXT,
  webhook_secret TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at     TIMESTAMPTZ
);

ALTER TABLE conditions ADD COLUMN IF NOT EXISTS owner TEXT;

CREATE TABLE IF NOT EXISTS api_outcomes (
  condition_id TEXT PRIMARY KEY,
  outcome      BOOLEAN NOT NULL,
  integration  TEXT NOT NULL,
  set_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Outbox for signed webhooks. One row per (integration, chain event); delivered at least once.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  integration     TEXT NOT NULL,
  event_id        TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  pot_id          BIGINT,
  payload         JSONB NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_status     INTEGER,
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (integration, event_id)
);
CREATE INDEX IF NOT EXISTS webhook_due_idx ON webhook_deliveries (next_attempt_at) WHERE delivered_at IS NULL;

-- Rate limiting for relay-sponsored (gasless) submissions.
CREATE TABLE IF NOT EXISTS gasless_requests (
  id          BIGSERIAL PRIMARY KEY,
  funder      TEXT NOT NULL,
  integration TEXT,
  kind        TEXT NOT NULL,
  amount      NUMERIC(78,0) NOT NULL,
  tx_hash     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS gasless_funder_idx ON gasless_requests (funder, created_at);

-- Every QuickNode Streams delivery that passed signature verification.
-- Arc Memo events (Memo contract 0x5294…E505) attached to our transactions. A memo covers the
-- logs between its BeforeMemo (before_log_index) and the Memo log itself, in the same tx.
CREATE TABLE IF NOT EXISTS memos (
  tx_hash          TEXT    NOT NULL,
  log_index        INTEGER NOT NULL,
  before_log_index INTEGER,
  memo_index       NUMERIC(78,0) NOT NULL,
  sender           TEXT NOT NULL,
  target           TEXT NOT NULL,
  memo_id          TEXT NOT NULL,
  memo_hex         TEXT NOT NULL,
  memo_text        TEXT,
  block_number     BIGINT NOT NULL,
  block_time       BIGINT,
  source           TEXT NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS memos_id_idx ON memos (memo_id);

-- A batched relay transaction can settle several pots.
CREATE TABLE IF NOT EXISTS relay_tx_pots (
  tx_hash TEXT NOT NULL,
  pot_id  BIGINT NOT NULL,
  PRIMARY KEY (tx_hash, pot_id)
);

-- What the relay signed, and when it first saw the outcome ("Verdict moment").
ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS outcome_seen_at TIMESTAMPTZ;
ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS digest TEXT;
ALTER TABLE resolutions ADD COLUMN IF NOT EXISTS reason TEXT;

-- Verdict Guarantees: product metadata for a pot that pays into the GuaranteeBook.
CREATE TABLE IF NOT EXISTS guarantees (
  id              TEXT PRIMARY KEY,           -- short public id used in /g/[id]
  gid             BIGINT UNIQUE,              -- GuaranteeBook id (set once opened on-chain)
  pot_id          BIGINT UNIQUE,
  template        TEXT NOT NULL,              -- rate | temperature | price | demo
  merchant_name   TEXT NOT NULL,
  merchant        TEXT NOT NULL,              -- funder / refundTo address
  event_ticker    TEXT NOT NULL,
  contract_ticker TEXT NOT NULL,
  side            TEXT NOT NULL,              -- yes | no: which settlement triggers refunds
  event_title     TEXT NOT NULL,
  contract_label  TEXT NOT NULL,
  promise         TEXT NOT NULL,              -- plain sentence rendered at creation from API fields
  refund          NUMERIC(78,0) NOT NULL,     -- per customer, 6-dp USDC
  max_customers   INTEGER NOT NULL,
  lock_time       BIGINT NOT NULL,
  settles_at      BIGINT NOT NULL,            -- market expiry
  deadline        BIGINT NOT NULL,            -- pot deadline
  condition_id    TEXT NOT NULL,
  created_tx      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | live | failed
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unlisted guarantees (test runs) stay on-chain and keep their proof page but are not shown in
-- product lists, the ledger or the landing page.
ALTER TABLE guarantees ADD COLUMN IF NOT EXISTS listed BOOLEAN NOT NULL DEFAULT true;

-- Passkey accounts (PasskeyAccountFactory): credential -> public key -> deterministic account.
-- Not vault-scoped: an account belongs to a person, not to a vault deployment.
CREATE TABLE IF NOT EXISTS passkeys (
  credential_id TEXT PRIMARY KEY,
  qx            TEXT NOT NULL,
  qy            TEXT NOT NULL,
  rp_id         TEXT NOT NULL,
  rp_id_hash    TEXT NOT NULL,
  account       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS passkeys_account_idx ON passkeys (account);

CREATE TABLE IF NOT EXISTS stream_batches (
  id            BIGSERIAL PRIMARY KEY,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  batch_start   BIGINT,
  batch_end     BIGINT,
  block_time    BIGINT,          -- unix seconds of batch_end
  latency_ms    INTEGER,         -- received_at - block_time(batch_end)
  bytes         INTEGER NOT NULL,
  gzip          BOOLEAN NOT NULL,
  logs          INTEGER NOT NULL, -- vault logs in the batch
  inserted      INTEGER NOT NULL, -- of which new to the index
  events        JSONB NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS stream_batches_recent_idx ON stream_batches (id DESC);

-- Drops (MerkleBook): one pot, a Merkle root over (index, account, amount) for many payees.
CREATE TABLE IF NOT EXISTS drops (
  id              TEXT PRIMARY KEY,
  drop_id         BIGINT UNIQUE,              -- MerkleBook id
  pot_id          BIGINT UNIQUE,
  name            TEXT NOT NULL,
  funder          TEXT NOT NULL,
  condition_key   TEXT NOT NULL,
  condition_label TEXT NOT NULL,
  condition_id    TEXT NOT NULL,
  lock_time       BIGINT NOT NULL,
  deadline        BIGINT NOT NULL,
  claim_deadline  BIGINT NOT NULL,
  root            TEXT NOT NULL,
  root_total      NUMERIC(78,0) NOT NULL,
  entries         INTEGER NOT NULL,
  version         INTEGER NOT NULL DEFAULT 1,
  listed          BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | live | failed
  error           TEXT,
  created_tx      TEXT,
  swept_tx        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drop_entries (
  drop_id    TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  account    TEXT NOT NULL,
  amount     NUMERIC(78,0) NOT NULL,
  proof      JSONB NOT NULL,
  version    INTEGER NOT NULL,
  claimed_tx TEXT,
  deferred   BOOLEAN NOT NULL DEFAULT false,
  failed     BOOLEAN NOT NULL DEFAULT false,
  error      TEXT,
  PRIMARY KEY (drop_id, idx)
);
CREATE INDEX IF NOT EXISTS drop_entries_account_idx ON drop_entries (drop_id, account);
CREATE INDEX IF NOT EXISTS drop_entries_pending_idx ON drop_entries (drop_id, idx) WHERE claimed_tx IS NULL;

-- HonorCat early payouts: pots resolved by the samplers' 2-of-3 MultisigResolver.
CREATE TABLE IF NOT EXISTS early_pots (
  id              TEXT PRIMARY KEY,
  pot_id          BIGINT UNIQUE,
  gid             BIGINT,                     -- GuaranteeBook id holding the recipients
  name            TEXT NOT NULL,
  funder          TEXT NOT NULL,
  event_ticker    TEXT NOT NULL,
  contract_ticker TEXT NOT NULL,
  instrument      TEXT NOT NULL,              -- Gemini instrumentSymbol
  side            TEXT NOT NULL,              -- yes | no
  mode            TEXT NOT NULL,              -- early-only | early-or-outcome
  template        TEXT NOT NULL,              -- demo | standard
  params          JSONB NOT NULL,             -- trigger parameters (committed in condition_id)
  amount          NUMERIC(78,0) NOT NULL,     -- per recipient
  max_recipients  INTEGER NOT NULL,
  lock_time       BIGINT NOT NULL,            -- joining closes, arming starts
  trading_close   BIGINT NOT NULL,            -- arming ends
  deadline        BIGINT NOT NULL,
  event_title     TEXT NOT NULL,
  contract_label  TEXT NOT NULL,
  promise         TEXT NOT NULL,
  condition_id    TEXT NOT NULL,
  resolver        TEXT NOT NULL,
  listed          BOOLEAN NOT NULL DEFAULT true,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | live | failed
  error           TEXT,
  created_tx      TEXT,
  settled_kind    TEXT,                       -- early | close | void | settle | expire | external
  settled_outcome BOOLEAN,
  settled_tx      TEXT,
  settled_at      TIMESTAMPTZ,
  evidence_root   TEXT,
  record_occurred BOOLEAN,
  record_status   TEXT,                       -- confirmed | market_wrong | voided
  record_tx       TEXT,
  record_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS early_signatures (
  early_id      TEXT NOT NULL REFERENCES early_pots(id) ON DELETE CASCADE,
  signer        TEXT NOT NULL,
  kind          TEXT NOT NULL,                -- trigger | close | void | settle
  outcome       BOOLEAN NOT NULL,
  evidence_hash TEXT,
  record        JSONB,
  attestation   TEXT,
  resolution    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (early_id, signer, kind)
);
CREATE TABLE IF NOT EXISTS early_samples (
  early_id  TEXT NOT NULL REFERENCES early_pots(id) ON DELETE CASCADE,
  signer    TEXT NOT NULL,
  t         BIGINT NOT NULL,                  -- ms
  mid_micro BIGINT,                           -- probability x 10^6 for the pot's side, null if no book
  status    SMALLINT NOT NULL,
  PRIMARY KEY (early_id, signer, t)
);

-- Market catalogue (catalog.ts): every active Gemini contract with its quotes and last book reading.
CREATE TABLE IF NOT EXISTS market_catalog (
  symbol    TEXT PRIMARY KEY,
  category  TEXT NOT NULL,
  close_ms  BIGINT NOT NULL,
  seen_at   BIGINT NOT NULL,
  book_at   BIGINT,
  listed    JSONB NOT NULL,
  book      JSONB
);
CREATE INDEX IF NOT EXISTS market_catalog_cat_idx ON market_catalog (category, close_ms);
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
  await db.exec(MIGRATIONS);
  await db.exec(SCHEMA);
  await scopeToVault(db, getConfig().vault);
  return db;
}

/**
 * Records which vault the read models describe. Data is never dropped here: the retired vault's
 * tables stay as they are (read-only), whatever VAULT_ADDRESS says.
 */
export async function scopeToVault(db: Db, vault: string): Promise<boolean> {
  const current = await getState(db, "vault");
  if (current?.toLowerCase() === vault.toLowerCase()) return false;
  // Never truncate: the retired contracts' data stays, read-only (user decision, 2026-11-16).
  if (current) console.warn(`[db] VAULT_ADDRESS changed from ${current} to ${vault}; existing data kept`);
  await setState(db, "vault", vault.toLowerCase());
  return current !== undefined;
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
