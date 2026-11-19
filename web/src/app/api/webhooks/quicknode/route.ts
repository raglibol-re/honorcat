import { after } from "next/server";
import { catalogTick } from "@/server/catalog";
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
  groups,
  perps,
  pots,
  ARC_MEMO,
  publicClient,
  recordBatch,
  verifyStreamsSignature,
} from "@/server/relay";

// Streams calls every few seconds: the app's early-payout sampler runs here in long bursts.
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
  // Two-sided pots (HonorCatPots v1 and every HonorCatRopes deployment): Streams is the primary path
  // for their events; ingestPotLogs sorts them by contract.
  const potAddresses = [...(cfg.pots ? [cfg.pots.address] : []), ...cfg.ropesAll.map((d) => d.address)];
  const potLogs = potAddresses.length ? extractStreamsLogs(payload, potAddresses) : [];
  // Perps: a log names the perp (first indexed topic); re-read those perps at once (the poller
  // records the events themselves a few blocks later).
  // Perps and group pots: recorded from the delivery itself (source "streams"), then re-read.
  const blockTimeOf = async (n: bigint) => Number((await publicClient().getBlock({ blockNumber: n })).timestamp);
  const perpsAt = cfg.ropes?.perps;
  const perpLogs = perpsAt ? extractStreamsLogs(payload, [perpsAt]) : [];
  if (perpLogs.length) await perps.ingestPerpLogs(db, perpLogs, blockTimeOf).catch((e) => console.error("[streams] perps", e));
  const groupLogs = cfg.groups ? extractStreamsLogs(payload, [cfg.groups.address]) : [];
  if (groupLogs.length) await groups.ingestGroupLogs(db, groupLogs, blockTimeOf).catch((e) => console.error("[streams] groups", e));
  const potResult = potLogs.length
    ? await pots.ingestPotLogs(db, potLogs, async (n) => Number((await publicClient().getBlock({ blockNumber: n })).timestamp)).catch((e) => {
        console.error("[streams] pots", e);
        return null;
      })
    : null;
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

  nudgeRelay("streams", { samplerBudgetMs: 45_000 });
  // And one bounded step of the market catalogue (lease-guarded, at most every 15 s).
  after(async () => {
    await catalogTick(await getDb()).catch((e) => console.error("[catalog] step", e));
  });
  return Response.json({ status: "received", ...result, pots: potResult });
}
