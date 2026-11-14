import { enqueuePing, getDb, integrationFrom, jsonError, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

/** Queues a signed `ping` to the calling integration's webhook URL; delivered on the next tick. */
export async function POST(req: Request) {
  const me = await integrationFrom(req);
  if (!me) return jsonError(401, "missing or invalid API key");
  if (!me.webhookUrl) return jsonError(400, "no webhook URL configured for this integration");
  const id = await enqueuePing(await getDb(), me.id);
  nudgeRelay("v1:ping");
  return Response.json({ queued: id });
}
