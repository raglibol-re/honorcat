import { z } from "zod";
import { buildSources, getDb, registerCondition } from "@/server/relay";

const body = z.object({
  source: z.string(),
  key: z.string().min(1).max(200),
  label: z.string().max(200).optional(),
});

/**
 * Registers an external condition so the relay knows which source answers it. The id is
 * derived from (source, key), so registering is idempotent and cannot change a condition's meaning.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "expected { source, key, label? }" }, { status: 400 });
  const db = await getDb();
  if (!buildSources(db)[parsed.data.source]) {
    return Response.json({ error: `unknown source '${parsed.data.source}'` }, { status: 400 });
  }
  const condition = await registerCondition(db, parsed.data.source, parsed.data.key, parsed.data.label);
  return Response.json(condition);
}
