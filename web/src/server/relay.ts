import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import { GaslessError, getDb, runTick, runAppSampler } from "@honorcat/relay";

export * from "@honorcat/relay";

/**
 * Runs a relay tick after the response is sent. Called from API reads (e.g. the live ledger
 * polling), the Streams webhook and the cron route, so the relay advances whenever anything
 * is looking at it. The tick itself is lease-guarded and rate-limited.
 */
/** `samplerBudgetMs`: how long this invocation may run the app's sampler (needs a matching maxDuration). */
export function nudgeRelay(reason: string, opts: { samplerBudgetMs?: number } = {}) {
  // With the background worker running elsewhere (relay/scripts/worker.ts on Render), requests to
  // the website never start relay work: no hidden background invocations, the worker does it all.
  if ((process.env.RELAY_WORKER ?? "").toLowerCase() === "on") return;
  after(async () => {
    try {
      const report = await runTick({ reason });
      if (report.ran && (report.actions?.length || report.early?.length || report.errors.length || report.indexed?.inserted)) {
        console.log("[relay] tick", JSON.stringify(report));
      }
      // The app's own early-payout sampler (one of three); a lease keeps it to one burst at a time.
      await pingSamplers().catch(() => {});
      const s = await runAppSampler(await getDb(), { budgetMs: opts.samplerBudgetMs ?? 40_000 });
      if (s.ran && s.pots) console.log("[sampler:vercel] burst", JSON.stringify(s));
    } catch (err) {
      console.error("[relay] tick failed", err);
    }
  });
}

let lastPing = 0;
/**
 * Wakes samplers hosted where idle services sleep (Render's free tier sleeps after 15 minutes
 * without a request). SAMPLER_PING_URLS: comma-separated health URLs. At most every 5 minutes per
 * instance; the relay is nudged by Streams every few seconds, so this keeps them awake.
 */
async function pingSamplers() {
  const urls = (process.env.SAMPLER_PING_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean);
  if (!urls.length || Date.now() - lastPing < 5 * 60_000) return;
  lastPing = Date.now();
  await Promise.all(urls.map((u) => fetch(u, { signal: AbortSignal.timeout(10_000) }).catch(() => null)));
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

export const authorizationBody = z.object({
  from: address,
  validAfter: uint,
  validBefore: uint,
  salt: hex32,
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).transform((s) => s as Hex),
});
