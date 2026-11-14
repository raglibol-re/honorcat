import { connection } from "next/server";
import { erc20Abi, getAddress, isAddress } from "viem";
import { accountGuarantees, ARC_USDC, getDb, publicClient } from "@/server/relay";

/** A payee account: USDC balance read from Arc, deployment state, and the guarantees it joined. */
export async function GET(_req: Request, ctx: RouteContext<"/api/accounts/[address]">) {
  await connection();
  const raw = (await ctx.params).address;
  if (!isAddress(raw)) return Response.json({ error: "invalid address" }, { status: 400 });
  const account = getAddress(raw);
  const client = publicClient();
  const [balance, code, guarantees] = await Promise.all([
    client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
    client.getCode({ address: account }),
    accountGuarantees(await getDb(), account),
  ]);
  return Response.json(
    { account, usdc: balance.toString(), fromChain: true, deployed: Boolean(code && code !== "0x"), guarantees },
    { headers: { "cache-control": "no-store" } },
  );
}
