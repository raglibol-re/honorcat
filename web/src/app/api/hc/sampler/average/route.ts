import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

const body = z.object({
  signer: address,
  record: z.record(z.string(), z.unknown()),
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  average: z
    .object({ priceYes: z.number().int().min(0).max(1_000_000), valid: z.boolean(), sampleCount: z.number().int().nonnegative(), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) })
    .optional(),
});

/** A sampler's own signed window average (its full evidence record). Checked before it counts. */
export async function POST(req: Request) {
  await connection();
  try {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    const b = body.parse(await req.json());
    const r = await pots.submitAverage(await getDb(), id, {
      signer: b.signer,
      record: b.record,
      signature: b.signature as `0x${string}`,
      average: b.average && { ...b.average, signature: b.average.signature as `0x${string}` },
    });
    nudgeRelay("hc:average");
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
