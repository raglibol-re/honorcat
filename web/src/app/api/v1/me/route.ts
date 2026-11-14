import { connection } from "next/server";
import { getConfig, integrationFrom, jsonError, resolverAccount } from "@/server/relay";

/** The calling integration plus the vault, resolver and chain to build pots against. */
export async function GET(req: Request) {
  await connection();
  const me = await integrationFrom(req);
  if (!me) return jsonError(401, "missing or invalid API key");
  const cfg = getConfig();
  return Response.json({ integration: me, chainId: cfg.chainId, vault: cfg.vault, resolver: resolverAccount().address });
}
