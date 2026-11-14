import { connection } from "next/server";
import { dropDetail, getConfig, getDb, merkleBookAbi, nudgeRelay, publicClient } from "@/server/relay";
import { json } from "@/server/drops";

/** One drop, with the root and amounts read live from the MerkleBook (marked fromChain). */
export async function GET(_req: Request, ctx: RouteContext<"/api/drops/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const drop = await dropDetail(await getDb(), id);
  if (!drop) return json({ error: "drop not found" }, { status: 404 });
  nudgeRelay("api:drop");
  const book = getConfig().merkle?.book ?? null;
  const onchain =
    book && drop.dropId
      ? await publicClient()
          .readContract({ address: book, abi: merkleBookAbi, functionName: "getDrop", args: [BigInt(drop.dropId)] })
          .then((d) => ({ fromChain: true as const, book, root: d.root, rootTotal: d.rootTotal.toString(), claimed: d.claimed.toString(), version: d.version, swept: d.swept }))
          .catch(() => null)
      : null;
  return json({ drop, onchain }, { headers: { "cache-control": "no-store" } });
}
