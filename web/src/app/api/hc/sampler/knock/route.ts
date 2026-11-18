import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, nudgeRelay, pots } from "@/server/relay";

const body = z.object({ potId: z.string().regex(/^\d+$/), windowEnd: z.number().int().positive() });

/** A sampler saw a short rope's price hold at a post: open one window so every sampler measures the same seconds. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    if (b.windowEnd > Math.floor(Date.now() / 1000) + 5) return Response.json({ error: "window ends in the future" }, { status: 400 });
    const id = await pots.openKnockWindow(await getDb(), b);
    nudgeRelay("hc:knock");
    return Response.json({ id });
  } catch (err) {
    return errorResponse(err);
  }
}
