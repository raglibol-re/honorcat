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
  const source = buildSources(db)[parsed.data.source];
  if (!source) {
    return Response.json({ error: `unknown source '${parsed.data.source}'` }, { status: 400 });
  }
  let label = parsed.data.label?.trim() || undefined;
  if (source.describe) {
    try {
      const described = await source.describe(parsed.data.key);
      label ??= described;
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
  }
  const condition = await registerCondition(db, parsed.data.source, parsed.data.key, label);
  return Response.json(condition);
}
