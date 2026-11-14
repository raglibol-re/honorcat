import { connection } from "next/server";
import { getConfig, getDb, getState, resolverAccount } from "@/server/relay";

/** Public, non-secret runtime info used by the e2e script and for debugging. */
export async function GET() {
  await connection();
  const cfg = getConfig();
  const db = await getDb();
  let resolver: string | null = null;
  try {
    resolver = resolverAccount().address;
  } catch {
    resolver = null;
  }
  return Response.json({
    ok: true,
    chainId: cfg.chainId,
    vault: cfg.vault,
    resolver,
    indexerPrimary: cfg.indexerPrimary,
    streamsConfigured: Boolean(cfg.streamsToken),
    lastIndexedBlock: (await getState(db, "rpc_last_indexed_block")) ?? null,
    lastTick: JSON.parse((await getState(db, "last_tick")) ?? "null"),
  });
}
