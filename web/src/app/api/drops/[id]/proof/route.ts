import { connection } from "next/server";
import { dropProofs, getConfig, getDb, merkleBookAbi, publicClient } from "@/server/relay";
import { json } from "@/server/drops";

/**
 * GET /api/drops/{id}/proof?account=0x… — the account's amount(s), index and Merkle proof, plus
 * whether each entry is already paid (read from the chain). Anyone can submit
 * MerkleBook.claim(dropId, index, account, amount, proof) with it; the money always goes to
 * `account`.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/drops/[id]/proof">) {
  await connection();
  const { id } = await ctx.params;
  const account = new URL(req.url).searchParams.get("account") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return json({ error: "account must be an address" }, { status: 400 });
  const res = await dropProofs(await getDb(), id, account as `0x${string}`);
  if (!res) return json({ error: "drop not found" }, { status: 404 });
  const book = getConfig().merkle?.book ?? null;
  const entries = await Promise.all(
    res.entries.map(async (e) => ({
      ...e,
      claimedOnChain:
        book && res.drop.dropId
          ? await publicClient()
              .readContract({ address: book, abi: merkleBookAbi, functionName: "isClaimed", args: [BigInt(res.drop.dropId), BigInt(e.index)] })
              .catch(() => null)
          : null,
    })),
  );
  return json(
    {
      drop: { id: res.drop.id, dropId: res.drop.dropId, root: res.drop.root, version: res.drop.version, book },
      included: entries.length > 0,
      total: entries.reduce((s, e) => s + BigInt(e.amount), 0n).toString(),
      entries,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
