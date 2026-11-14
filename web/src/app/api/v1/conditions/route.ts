import { conditionBody, errorResponse, getDb, integrationFrom, jsonError, registerFor } from "@/server/relay";

/** Registers a condition owned by the calling integration. Body: { source, key, label? }. */
export async function POST(req: Request) {
  const me = await integrationFrom(req);
  if (!me) return jsonError(401, "missing or invalid API key");
  try {
    const input = conditionBody.parse(await req.json().catch(() => null));
    return Response.json(await registerFor(await getDb(), input, me));
  } catch (err) {
    return errorResponse(err);
  }
}
