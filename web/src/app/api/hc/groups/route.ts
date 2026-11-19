import { connection } from "next/server";
import { errorResponse, getDb, groups } from "@/server/relay";

/** Group pots for the lists (?account= for one player's groups), with whether groups are on. */
export async function GET(req: Request) {
  await connection();
  try {
    const status = groups.groupsStatus();
    if (!status.available) return Response.json({ status, groups: [] });
    const account = new URL(req.url).searchParams.get("account");
    const list = await groups.listGroups(await getDb(), { account: account && /^0x[0-9a-fA-F]{40}$/.test(account) ? account : null });
    return Response.json({ status, groups: list }, { headers: { "cache-control": account ? "no-store" : "public, s-maxage=5, stale-while-revalidate=10" } });
  } catch (err) {
    return errorResponse(err);
  }
}
