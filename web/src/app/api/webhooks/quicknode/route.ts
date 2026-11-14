import {
  blockTimeFromRpc,
  decodeBody,
  extractStreamsLogs,
  getConfig,
  getDb,
  ingestLogs,
  nudgeRelay,
  publicClient,
  verifyStreamsSignature,
} from "@/server/relay";

export const maxDuration = 60;

/**
 * QuickNode Streams webhook destination. Verifies the HMAC signature, ingests our contract's
 * logs (idempotent), and uses the delivery as a clock to advance the relay.
 */
export async function POST(req: Request) {
  const cfg = getConfig();
  if (!cfg.streamsToken) return Response.json({ error: "streams not configured" }, { status: 503 });

  const body = decodeBody(new Uint8Array(await req.arrayBuffer()));
  const ok = verifyStreamsSignature(cfg.streamsToken, body, {
    nonce: req.headers.get("x-qn-nonce"),
    timestamp: req.headers.get("x-qn-timestamp"),
    signature: req.headers.get("x-qn-signature"),
  });
  if (!ok) return Response.json({ error: "invalid signature" }, { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const logs = extractStreamsLogs(payload, cfg.vault);
  const result = logs.length
    ? await ingestLogs(await getDb(), cfg.vault, logs, "streams", blockTimeFromRpc(publicClient()))
    : { received: 0, inserted: 0, pots: [] };

  nudgeRelay("streams");
  return Response.json({ status: "received", ...result });
}
