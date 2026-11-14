import {
  blockTimeFromRpc,
  decodeBody,
  decodeVaultLogs,
  extractBatchRange,
  extractStreamsLogs,
  getConfig,
  getDb,
  ingestLogs,
  nudgeRelay,
  ARC_MEMO,
  publicClient,
  recordBatch,
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

  const raw = new Uint8Array(await req.arrayBuffer());
  const gzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  const body = decodeBody(raw);
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

  const db = await getDb();
  // Vault, GuaranteeBook and Arc Memo logs; ingestLogs keeps memo logs only for our transactions.
  const logs = extractStreamsLogs(payload, [cfg.vault, ...(cfg.guarantees ? [cfg.guarantees.book] : []), ...(cfg.merkle ? [cfg.merkle.book] : []), ARC_MEMO]);
  const vaultLogs = logs.filter((l) => l.address.toLowerCase() === cfg.vault.toLowerCase());
  const result = logs.length
    ? await ingestLogs(db, cfg.vault, logs, "streams", blockTimeFromRpc(publicClient()))
    : { received: 0, inserted: 0, pots: [] };

  const range = extractBatchRange(payload);
  await recordBatch(db, {
    start: range.start,
    end: range.end ?? (logs.length ? logs.reduce((m, l) => (l.blockNumber > m ? l.blockNumber : m), 0n) : null),
    bytes: raw.length,
    gzip,
    logs: vaultLogs.length,
    inserted: result.inserted,
    events: decodeVaultLogs(vaultLogs, cfg.vault).map((d) => ({
      name: d.eventName,
      potId: d.potId?.toString() ?? null,
      block: d.blockNumber.toString(),
    })),
  }).catch((err) => console.error("[streams] could not record batch", err));

  nudgeRelay("streams");
  return Response.json({ status: "received", ...result });
}
