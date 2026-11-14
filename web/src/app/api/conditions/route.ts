import { conditionBody, errorResponse, getDb, integrationFrom, registerFor } from "@/server/relay";

/**
 * Registers an external condition so the relay knows which source answers it. The id is
 * keccak256("<source>:<key>"), so registering is idempotent and cannot change a condition's
 * meaning. An API key is optional here (required for source "api"); see /api/v1/conditions.
 */
export async function POST(req: Request) {
  try {
    const input = conditionBody.parse(await req.json().catch(() => null));
    return Response.json(await registerFor(await getDb(), input, await integrationFrom(req)));
  } catch (err) {
    return errorResponse(err);
  }
}
