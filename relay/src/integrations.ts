import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";

/**
 * Integrations are the apps built on top of Verdict. Each one gets:
 * - an API key (`vk_<id>_<secret>`, only the SHA-256 is stored) for the /api/v1 routes,
 * - its own conditions (source "api"), whose outcomes only it may report,
 * - signed webhooks for every on-chain event of pots that use its conditions.
 */
export type Integration = {
  id: string;
  name: string;
  webhookUrl: string | null;
  createdAt: string;
  revokedAt: string | null;
};

type Row = { id: string; name: string; webhook_url: string | null; created_at: string; revoked_at: string | null };

const toIntegration = (r: Row): Integration => ({
  id: r.id,
  name: r.name,
  webhookUrl: r.webhook_url,
  createdAt: new Date(r.created_at).toISOString(),
  revokedAt: r.revoked_at ? new Date(r.revoked_at).toISOString() : null,
});

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export function validateWebhookUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = new URL(url);
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) {
    throw new Error("webhookUrl must be https (http only for localhost)");
  }
  return u.toString();
}

/** Creates an integration. The API key and webhook secret are returned once and never again. */
export async function createIntegration(db: Db, input: { name: string; webhookUrl?: string | null }) {
  const id = randomBytes(6).toString("hex");
  const apiKey = `vk_${id}_${randomBytes(24).toString("base64url")}`;
  const webhookSecret = `whsec_${randomBytes(24).toString("base64url")}`;
  const rows = await db.query<Row>(
    `INSERT INTO integrations (id, name, key_hash, webhook_url, webhook_secret) VALUES ($1, $2, $3, $4, $5)
     RETURNING id, name, webhook_url, created_at, revoked_at`,
    [id, input.name, sha256(apiKey), validateWebhookUrl(input.webhookUrl), webhookSecret],
  );
  return { integration: toIntegration(rows[0]!), apiKey, webhookSecret };
}

export async function listIntegrations(db: Db): Promise<Integration[]> {
  const rows = await db.query<Row>(
    "SELECT id, name, webhook_url, created_at, revoked_at FROM integrations ORDER BY created_at",
  );
  return rows.map(toIntegration);
}

export async function updateIntegration(db: Db, id: string, input: { webhookUrl?: string | null; revoke?: boolean }) {
  if (input.webhookUrl !== undefined) {
    await db.query("UPDATE integrations SET webhook_url = $2 WHERE id = $1", [id, validateWebhookUrl(input.webhookUrl)]);
  }
  if (input.revoke) await db.query("UPDATE integrations SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  const rows = await db.query<Row>("SELECT id, name, webhook_url, created_at, revoked_at FROM integrations WHERE id = $1", [id]);
  return rows[0] ? toIntegration(rows[0]) : null;
}

/** Resolves `Authorization: Bearer vk_…` to an active integration, in constant time per candidate. */
export async function authenticate(db: Db, authorization: string | null): Promise<Integration | null> {
  const m = /^Bearer\s+(vk_([0-9a-f]{12})_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return null;
  const rows = await db.query<Row & { key_hash: string }>(
    "SELECT id, name, webhook_url, created_at, revoked_at, key_hash FROM integrations WHERE id = $1",
    [m[2]],
  );
  const row = rows[0];
  if (!row || row.revoked_at) return null;
  const a = Buffer.from(sha256(m[1]!), "hex");
  const b = Buffer.from(row.key_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? toIntegration(row) : null;
}

export async function webhookSecretFor(db: Db, id: string): Promise<string | null> {
  const rows = await db.query<{ webhook_secret: string }>("SELECT webhook_secret FROM integrations WHERE id = $1", [id]);
  return rows[0]?.webhook_secret ?? null;
}
