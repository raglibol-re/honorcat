import { connection } from "next/server";
import { getDb, guaranteeBookAbi, guaranteeDetail, nudgeRelay, publicClient, verdictVaultAbi } from "@/server/relay";
import { marketByTicker, toMarket } from "@/server/guarantees";

export const maxDuration = 60;

/**
 * One guarantee: terms, indexed chain history, memos, the signed result, timings, plus two live
 * reads made for this request: the pot read from the chain (amounts marked `fromChain`) and the
 * Gemini market (chance marked as an estimate).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/guarantees/[id]">) {
  await connection();
  const { id } = await ctx.params;
  const db = await getDb();
  const detail = await guaranteeDetail(db, id);
  if (!detail) return Response.json({ error: "guarantee not found" }, { status: 404 });
  nudgeRelay("api:guarantee");

  const g = detail.guarantee;
  const client = publicClient();
  const [onchain, market] = await Promise.all([
    g.potId
      ? Promise.all([
          client.readContract({ address: detail.chain.vault, abi: verdictVaultAbi, functionName: "getPot", args: [BigInt(g.potId)] }),
          detail.chain.book && g.gid
            ? client.readContract({ address: detail.chain.book, abi: guaranteeBookAbi, functionName: "getGuarantee", args: [BigInt(g.gid)] })
            : null,
          client.getBlockNumber(),
        ])
          .then(([pot, book, block]) => ({
            fromChain: true as const,
            block: block.toString(),
            potStatus: ["none", "open", "resolved", "expired"][pot.status] ?? "unknown",
            potOutcome: pot.outcome,
            potTotal: pot.total.toString(),
            enrolled: book ? book.enrolled : null,
            refundsSettled: book ? book.settled : null,
          }))
          .catch(() => null)
      : null,
    marketByTicker(g.eventTicker)
      .then((e) => {
        if (!e) return null;
        const m = toMarket(e);
        const raw = e.contracts.find((c) => c.ticker === g.contractTicker);
        const c = m.contracts.find((x) => x.ticker === g.contractTicker) ?? null;
        return {
          estimate: true as const,
          status: raw?.status ?? null,
          resolutionSide: raw?.resolutionSide ?? null,
          chanceYes: c?.chanceYes ?? null,
          chanceOfRefund: c?.chanceYes === null || c?.chanceYes === undefined ? null : g.side === "yes" ? c.chanceYes : 1 - c.chanceYes,
          strike: raw?.strike ?? null,
        };
      })
      .catch(() => null),
  ]);

  return Response.json({ ...detail, onchain, market }, { headers: { "cache-control": "no-store" } });
}
