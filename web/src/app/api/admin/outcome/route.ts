import { z } from "zod";
import { getCondition, getConfig, getDb, hasBearer, ManualSource, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

const body = z.object({
  conditionId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  outcome: z.boolean(),
});

/** Sets the result of a `manual` condition. Requires `Authorization: Bearer $ADMIN_TOKEN`. */
export async function POST(req: Request) {
  if (!hasBearer(req, getConfig().adminToken)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "expected { conditionId, outcome }" }, { status: 400 });

  const db = await getDb();
  const conditionId = parsed.data.conditionId.toLowerCase() as `0x${string}`;
  const condition = await getCondition(db, conditionId);
  if (!condition) return Response.json({ error: "unknown condition" }, { status: 404 });
  if (condition.source !== "manual") return Response.json({ error: "not a manual condition" }, { status: 400 });

  await new ManualSource(db).setOutcome(conditionId, parsed.data.outcome);
  nudgeRelay("admin:outcome");
  return Response.json({ ok: true, conditionId, outcome: parsed.data.outcome });
}
