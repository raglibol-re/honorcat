import { connection } from "next/server";
import { z } from "zod";
import { createIntegration, errorResponse, getConfig, getDb, hasBearer, jsonError, listIntegrations } from "@/server/relay";

const body = z.object({ name: z.string().min(1).max(80), webhookUrl: z.string().url().nullable().optional() });

/** Lists integrations. Requires `Authorization: Bearer $ADMIN_TOKEN`. */
export async function GET(req: Request) {
  await connection();
  if (!hasBearer(req, getConfig().adminToken)) return jsonError(401, "unauthorized");
  return Response.json({ integrations: await listIntegrations(await getDb()) });
}

/** Creates an integration. The API key and webhook secret appear only in this response. */
export async function POST(req: Request) {
  if (!hasBearer(req, getConfig().adminToken)) return jsonError(401, "unauthorized");
  try {
    const input = body.parse(await req.json().catch(() => null));
    return Response.json(await createIntegration(await getDb(), input), { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
