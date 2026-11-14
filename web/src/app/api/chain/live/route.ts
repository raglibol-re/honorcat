import { connection } from "next/server";
import { getDb, publicClient } from "@/server/relay";

/** Current Arc block and the latency of the relay's last confirmed transaction (broadcast → receipt). */
export async function GET() {
  await connection();
  const db = await getDb();
  const [block, last] = await Promise.all([
    publicClient()
      .getBlock({ blockTag: "latest" })
      .catch(() => null),
    db.query<{ tx_hash: string; latency_ms: number; confirmed_at: string }>(
      "SELECT tx_hash, latency_ms, confirmed_at FROM relay_txs WHERE status = 'confirmed' AND latency_ms IS NOT NULL ORDER BY confirmed_at DESC LIMIT 1",
    ),
  ]);
  return Response.json(
    {
      block: block ? { number: block.number.toString(), timestamp: Number(block.timestamp) } : null,
      lastConfirmation: last[0] ? { tx: last[0].tx_hash, latencyMs: last[0].latency_ms, at: new Date(last[0].confirmed_at).toISOString() } : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
