import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "./config";
import type { Db } from "./db";

/**
 * Signed, retried webhooks (transactional outbox).
 *
 * Every new vault event is turned into a delivery row for each integration that owns the pot's
 * condition, in the same ingestion pass that stores the event. Ticks deliver due rows with
 * exponential backoff. Deliveries are at-least-once: receivers dedupe on `Verdict-Event-Id`.
 *
 * Signature: `Verdict-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
 */

export const EVENT_TYPES: Record<string, string> = {
  PotCreated: "pot.created",
  PotFunded: "pot.funded",
  PotResolved: "pot.resolved",
  PotExpired: "pot.expired",
  Payout: "payment.payout",
  Refund: "payment.refund",
  PaymentDeferred: "payment.deferred",
};

export type IngestedEvent = {
  txHash: string;
  logIndex: number;
  blockNumber: bigint;
  blockTime: number | null;
  eventName: string;
  potId: bigint | null;
  args: Record<string, unknown>;
};

export type WebhookPayload = {
  id: string;
  type: string;
  createdAt: string;
  chainId: number;
  vault: string;
  potId: string | null;
  txHash: string | null;
  blockNumber: string | null;
  blockTime: number | null;
  data: Record<string, unknown>;
};

const MAX_ATTEMPTS = 12;

export function signPayload(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

/** Verifies a `Verdict-Signature` header. Rejects timestamps older than `toleranceSec`. */
export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  toleranceSec = 300,
  now = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries((header ?? "").split(",").map((kv) => kv.trim().split("=", 2) as [string, string]));
  const t = Number(parts.t);
  if (!Number.isFinite(t) || !parts.v1 || Math.abs(now - t) > toleranceSec) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"), "hex");
  const got = Buffer.from(parts.v1, "hex");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

/** Creates delivery rows for newly ingested events. Idempotent per (integration, event). */
export async function enqueueWebhooks(db: Db, events: IngestedEvent[]): Promise<number> {
  let n = 0;
  for (const e of events) {
    const type = EVENT_TYPES[e.eventName];
    if (!type || e.potId === null) continue;
    const owners = await db.query<{ id: string }>(
      `SELECT i.id FROM pots p
       JOIN conditions c ON c.condition_id = p.condition_id
       JOIN integrations i ON i.id = c.owner
       WHERE p.pot_id = $1 AND i.webhook_url IS NOT NULL AND i.revoked_at IS NULL`,
      [e.potId.toString()],
    );
    if (!owners.length) continue;
    const { chainId, vault } = getConfig();
    const id = `${e.txHash}:${e.logIndex}`;
    const payload: WebhookPayload = {
      id,
      type,
      createdAt: new Date().toISOString(),
      chainId,
      vault: vault.toLowerCase(),
      potId: e.potId.toString(),
      txHash: e.txHash,
      blockNumber: e.blockNumber.toString(),
      blockTime: e.blockTime,
      data: e.args,
    };
    for (const o of owners) {
      const rows = await db.query(
        `INSERT INTO webhook_deliveries (integration, event_id, event_type, pot_id, payload)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (integration, event_id) DO NOTHING RETURNING id`,
        [o.id, id, type, e.potId.toString(), JSON.stringify(payload)],
      );
      n += rows.length;
    }
  }
  return n;
}

/** Queues a `ping` event so an integration can test its endpoint and signature check. */
export async function enqueuePing(db: Db, integration: string): Promise<string> {
  const { chainId, vault } = getConfig();
  const id = `ping:${randomBytes(8).toString("hex")}`;
  const payload: WebhookPayload = {
    id,
    type: "ping",
    createdAt: new Date().toISOString(),
    chainId,
    vault: vault.toLowerCase(),
    potId: null,
    txHash: null,
    blockNumber: null,
    blockTime: null,
    data: {},
  };
  await db.query(
    `INSERT INTO webhook_deliveries (integration, event_id, event_type, payload) VALUES ($1, $2, 'ping', $3)`,
    [integration, id, JSON.stringify(payload)],
  );
  return id;
}

type Due = { id: string; integration: string; event_id: string; payload: unknown; attempts: number; url: string; secret: string };

/** Delivers due webhooks. Called from every relay tick, bounded by `limit` and `deadlineMs`. */
export async function deliverDueWebhooks(
  db: Db,
  opts: { limit?: number; deadlineMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ delivered: number; failed: number }> {
  const started = Date.now();
  const doFetch = opts.fetchImpl ?? fetch;
  const due = await db.query<Due>(
    `SELECT d.id::text AS id, d.integration, d.event_id, d.payload, d.attempts, i.webhook_url AS url, i.webhook_secret AS secret
     FROM webhook_deliveries d JOIN integrations i ON i.id = d.integration
     WHERE d.delivered_at IS NULL AND d.next_attempt_at <= now() AND d.attempts < $1
       AND i.webhook_url IS NOT NULL AND i.revoked_at IS NULL
     ORDER BY d.id LIMIT $2`,
    [MAX_ATTEMPTS, opts.limit ?? 25],
  );
  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    if (opts.deadlineMs && Date.now() - started > opts.deadlineMs) break;
    const body = typeof d.payload === "string" ? d.payload : JSON.stringify(d.payload);
    let status: number | null = null;
    let error: string | null = null;
    try {
      const res = await doFetch(d.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Verdict-Webhooks/1",
          "verdict-event-id": d.event_id,
          "verdict-signature": signPayload(d.secret, body),
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
      });
      status = res.status;
      if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    if (!error) {
      delivered++;
      await db.query(
        "UPDATE webhook_deliveries SET delivered_at = now(), attempts = attempts + 1, last_status = $2, last_error = NULL WHERE id = $1",
        [d.id, status],
      );
    } else {
      failed++;
      // 10s, 20s, 40s … capped at 1h.
      const delay = Math.min(10 * 2 ** d.attempts, 3600);
      await db.query(
        `UPDATE webhook_deliveries SET attempts = attempts + 1, last_status = $2, last_error = $3,
           next_attempt_at = now() + ($4::int * interval '1 second') WHERE id = $1`,
        [d.id, status, error.slice(0, 300), delay],
      );
    }
  }
  return { delivered, failed };
}

export async function listDeliveries(db: Db, integration: string, limit = 50) {
  return db.query<{
    event_id: string;
    event_type: string;
    pot_id: string | null;
    attempts: number;
    last_status: number | null;
    last_error: string | null;
    delivered_at: string | null;
    created_at: string;
  }>(
    `SELECT event_id, event_type, pot_id::text AS pot_id, attempts, last_status, last_error, delivered_at, created_at
     FROM webhook_deliveries WHERE integration = $1 ORDER BY id DESC LIMIT $2`,
    [integration, limit],
  );
}
