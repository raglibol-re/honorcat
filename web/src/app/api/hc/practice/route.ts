import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, nudgeRelay, practiceAddress, practiceJoin } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ potId: z.string().regex(/^\d+$/) });

/** Who the practice cat is (HonorCat's testnet account). */
export async function GET() {
  await connection();
  return Response.json({ address: practiceAddress(), maxNotional: "2000000" });
}

/** The practice cat takes the other side of a small open pot (test money). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = await practiceJoin(await getDb(), b.potId);
    nudgeRelay("hc:practice", { samplerBudgetMs: 45_000 });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
