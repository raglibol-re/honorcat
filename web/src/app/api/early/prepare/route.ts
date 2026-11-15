import { z } from "zod";
import { address, errorResponse, prepareEarly } from "@/server/relay";
import { earlyTermsFrom, sealEarly, toEarlyTerms } from "@/server/early";

const body = z.object({
  name: z.string().trim().min(1).max(60),
  funder: address,
  eventTicker: z.string().min(1).max(120),
  contractTicker: z.string().min(1).max(120),
  side: z.enum(["yes", "no"]),
  mode: z.enum(["early-only", "early-or-outcome"]),
  thresholdBps: z.number().int().min(5000).max(9900).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  maxRecipients: z.number().int().min(1).max(50),
  joinSeconds: z.number().int().min(30).max(7 * 86400).optional(),
  listed: z.boolean().optional(),
});

/**
 * Builds early-payout terms from a live Gemini contract (parameters by the market's horizon),
 * seals them, and returns the EIP-3009 typed data the funder signs once.
 */
export async function POST(req: Request) {
  try {
    const terms = await earlyTermsFrom(body.parse(await req.json().catch(() => null)));
    const { amount, prepared } = await prepareEarly(toEarlyTerms(terms));
    const json = JSON.stringify({ terms, seal: sealEarly(terms), amount: amount.toString(), ...prepared }, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
    return new Response(json, { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}
