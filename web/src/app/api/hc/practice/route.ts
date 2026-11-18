import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, nudgeRelay, practiceAddress, practiceJoin, practiceJoinPerp, practiceStatus } from "@/server/relay";

export const maxDuration = 60;

const body = z.union([z.object({ potId: z.string().regex(/^\d+$/) }), z.object({ perpId: z.string().regex(/^\d+$/) })]);

/** Who the practice cat is (HonorCat's testnet account) and whether it can play right now. */
export async function GET() {
  await connection();
  try {
    return Response.json({ address: practiceAddress(), maxNotional: "2000000", ...(await practiceStatus(await getDb())) });
  } catch (err) {
    return errorResponse(err);
  }
}

/** The practice cat takes the other side of a small open pot (test money). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const r = "perpId" in b ? await practiceJoinPerp(await getDb(), b.perpId) : await practiceJoin(await getDb(), b.potId);
    nudgeRelay("hc:practice", { samplerBudgetMs: 45_000 });
    return Response.json(r);
  } catch (err) {
    return errorResponse(err);
  }
}
