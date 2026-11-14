import "server-only";
import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { runTick } from "@verdict/relay";

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
