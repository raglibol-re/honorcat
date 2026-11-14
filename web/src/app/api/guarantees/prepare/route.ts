import { z } from "zod";
import { address, errorResponse, prepareGuarantee } from "@/server/relay";
import { defaultTimes, marketByTicker, promiseFor, TEMPLATE_INFO, type Template } from "@/server/guarantees";
import { sealTerms, toTerms, type TermsJson } from "@/server/terms";

const body = z.object({
  template: z.enum(Object.keys(TEMPLATE_INFO) as [Template, ...Template[]]),
  eventTicker: z.string().min(1).max(100),
  contractTicker: z.string().min(1).max(100),
  side: z.enum(["yes", "no"]),
  merchantName: z.string().trim().min(1).max(60),
  merchant: address,
  refund: z.string().regex(/^\d+(\.\d{1,6})?$/),
  maxCustomers: z.number().int().min(1).max(50),
  lockTime: z.number().int().optional(),
  /** false creates an unlisted guarantee (test runs): real and provable, not shown in lists. */
  listed: z.boolean().optional(),
});

const units = (v: string) => {
  const [i, f = ""] = v.split(".");
  return BigInt(i!) * 1_000_000n + BigInt((f + "000000").slice(0, 6));
};

/**
 * Builds the guarantee terms from the live Gemini market (promise rendered from API fields),
 * seals them, and returns the EIP-3009 typed data the merchant signs to fund every seat.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const ev = await marketByTicker(input.eventTicker);
    const c = ev?.contracts.find((x) => x.ticker === input.contractTicker);
    if (!ev || !c) return Response.json({ error: "market not found on Gemini" }, { status: 404 });
    if (ev.status !== "active" || c.status !== "active") return Response.json({ error: "this market is not active" }, { status: 409 });
    const expiry = Math.floor(new Date(ev.expiryDate ?? 0).getTime() / 1000);
    const times = defaultTimes(input.template, expiry);
    const lockTime = input.lockTime && input.lockTime < expiry && input.lockTime > Date.now() / 1000 + 30 ? input.lockTime : times.lockTime;
    const refundUnits = units(input.refund);
    const terms: TermsJson = {
      template: input.template,
      merchantName: input.merchantName,
      merchant: input.merchant,
      eventTicker: ev.ticker,
      contractTicker: c.ticker,
      side: input.side,
      eventTitle: ev.title,
      contractLabel: c.label,
      promise: promiseFor(input.template, ev, c, input.side, input.merchantName, (Number(refundUnits) / 1e6).toFixed(2)),
      refund: refundUnits.toString(),
      maxCustomers: input.maxCustomers,
      lockTime,
      settlesAt: expiry,
      deadline: times.deadline,
      listed: input.listed !== false,
    };
    const { amount, prepared } = await prepareGuarantee(toTerms(terms));
    const json = JSON.stringify(
      { terms, seal: sealTerms(terms), amount: amount.toString(), ...prepared },
      (_k, v) => (typeof v === "bigint" ? v.toString() : v),
    );
    return new Response(json, { headers: { "content-type": "application/json" } });
  } catch (err) {
    return errorResponse(err);
  }
}
