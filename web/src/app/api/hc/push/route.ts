import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, pushPublicKey, savePushSub } from "@/server/relay";

const body = z.object({
  potId: z.string().regex(/^\d+$/),
  account: z.string().regex(/^0x[0-9a-fA-F]{40}$/).nullable().optional(),
  subscription: z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }) }),
});

/** The VAPID public key browsers subscribe with. */
export async function GET() {
  await connection();
  const key = pushPublicKey();
  return key ? Response.json({ publicKey: key }) : Response.json({ error: "notifications are not configured" }, { status: 503 });
}

/** Saves a browser's push subscription for one pot. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    await savePushSub(await getDb(), { potId: b.potId, account: b.account ?? null, subscription: b.subscription });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
