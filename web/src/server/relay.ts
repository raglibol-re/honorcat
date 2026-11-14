import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import {
  authenticate,
  buildSources,
  GaslessError,
  getDb,
  registerCondition,
  runTick,
  type Db,
  type Integration,
} from "@verdict/relay";

export * from "@verdict/relay";

/**
 * Runs a relay tick after the response is sent. Called from API reads (e.g. the live ledger
 * polling), the Streams webhook and the cron route, so the relay advances whenever anything
 * is looking at it. The tick itself is lease-guarded and rate-limited.
 */
export function nudgeRelay(reason: string) {
  after(async () => {
    try {
      const report = await runTick({ reason });
      if (report.ran && (report.actions?.length || report.errors.length || report.indexed?.inserted)) {
        console.log("[relay] tick", JSON.stringify(report));
      }
    } catch (err) {
      console.error("[relay] tick failed", err);
    }
  });
}

/** Constant-time check of `Authorization: Bearer <secret>`. Fails closed when the secret is unset. */
export function hasBearer(req: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function jsonError(status: number, message: string) {
  return Response.json({ error: message }, { status });
}

// ---------------------------------------------------------------- shared request helpers


/** The integration behind `Authorization: Bearer vk_…`, or null (no/unknown/revoked key). */
export async function integrationFrom(req: Request): Promise<Integration | null> {
  return authenticate(await getDb(), req.headers.get("authorization"));
}

/** Maps thrown errors (with an optional numeric `status`) to JSON responses. */
export function errorResponse(err: unknown) {
  const status =
    err instanceof GaslessError ? err.status : typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 400;
  const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") : (err as Error)?.message ?? String(err);
  if (status >= 500) console.error("[api]", err);
  return Response.json({ error: message }, { status });
}

export const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s.toLowerCase() as Hex);
export const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((s) => getAddress(s) as Address);
export const uint = z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v));

export const conditionBody = z.object({
  source: z.string(),
  key: z.string().min(1).max(1000),
  label: z.string().max(200).optional(),
});

/**
 * Registers a condition for a source: canonicalises the key, lets the source validate it and
 * propose a label, and records the owning integration (required for sources like `api`).
 */
export async function registerFor(db: Db, input: z.infer<typeof conditionBody>, owner: Integration | null) {
  const source = buildSources(db)[input.source];
  if (!source) throw Object.assign(new Error(`unknown source '${input.source}'`), { status: 400 });
  if (source.requiresOwner && !owner) {
    throw Object.assign(new Error(`source '${input.source}' needs an API key (Authorization: Bearer vk_…)`), { status: 401 });
  }
  const key = source.normalizeKey ? source.normalizeKey(input.key) : input.key;
  let label = input.label?.trim() || undefined;
  if (source.describe) label ??= await source.describe(key);
  return registerCondition(db, input.source, key, label, owner?.id ?? null);
}

export const potParamsBody = z.object({
  conditionId: hex32,
  resolver: address,
  payees: z.array(address).min(1).max(20),
  sharesBps: z.array(z.number().int().min(1).max(10_000)).min(1).max(20),
  refundTo: address,
  deadline: uint,
});

export const authorizationBody = z.object({
  from: address,
  validAfter: uint,
  validBefore: uint,
  salt: hex32,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((s) => s as Hex),
});
