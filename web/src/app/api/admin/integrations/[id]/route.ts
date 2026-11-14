import { z } from "zod";
import { errorResponse, getConfig, getDb, hasBearer, jsonError, updateIntegration } from "@/server/relay";

const body = z.object({ webhookUrl: z.string().url().nullable().optional(), revoke: z.boolean().optional() });

/** Changes the webhook URL or revokes the key. Requires `Authorization: Bearer $ADMIN_TOKEN`. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/admin/integrations/[id]">) {
  if (!hasBearer(req, getConfig().adminToken)) return jsonError(401, "unauthorized");
  try {
    const input = body.parse(await req.json().catch(() => null));
    const updated = await updateIntegration(await getDb(), (await ctx.params).id, input);
    return updated ? Response.json(updated) : jsonError(404, "integration not found");
  } catch (err) {
    return errorResponse(err);
  }
}
