import "server-only";
import { z } from "zod";
import { address, type DropTerms } from "@/server/relay";
import { marketByTicker } from "@/server/guarantees";

/** Amounts are 6-decimal USDC base units as decimal strings ("1250000" = 1.25 USDC). */
export const entriesBody = z
  .array(z.object({ account: address, amount: z.string().regex(/^[1-9]\d{0,17}$/) }))
  .min(1)
  .max(20_000)
  .transform((xs) => xs.map((x) => ({ account: x.account, amount: BigInt(x.amount) })));

export const dropBody = z.object({
  name: z.string().trim().min(1).max(80),
  funder: address,
  eventTicker: z.string().min(1).max(100),
  contractTicker: z.string().min(1).max(100),
  side: z.enum(["yes", "no"]),
  /** Unix seconds; the list can be replaced until then. Defaults to 6 h (or half the time) before expiry. */
  lockTime: z.number().int().optional(),
  entries: entriesBody,
  listed: z.boolean().optional(),
});

/** Turns a request into drop terms bound to a live Gemini contract. Throws a status-bearing error. */
export async function dropTermsFrom(input: z.infer<typeof dropBody>): Promise<DropTerms> {
  const ev = await marketByTicker(input.eventTicker);
  const c = ev?.contracts.find((x) => x.ticker === input.contractTicker);
  if (!ev || !c) throw Object.assign(new Error("market not found on Gemini"), { status: 404 });
  if (ev.status !== "active" || c.status !== "active") throw Object.assign(new Error("this market is not active"), { status: 409 });
  const expiry = Math.floor(new Date(ev.expiryDate ?? 0).getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const defaultLock = Math.max(now + 60, Math.min(expiry - 6 * 3600, now + Math.floor((expiry - now) / 2)));
  const lockTime = input.lockTime && input.lockTime > now + 30 && input.lockTime < expiry ? input.lockTime : defaultLock;
  return {
    name: input.name,
    funder: input.funder,
    conditionKey: `${ev.ticker}:${c.ticker}${input.side === "no" ? ":no" : ""}`,
    conditionLabel: `${ev.title} — ${c.label}${input.side === "no" ? " (settles No)" : ""}`,
    lockTime,
    deadline: expiry + 2 * 86400,
    entries: input.entries,
    listed: input.listed !== false,
  };
}

export const json = (v: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)), {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
