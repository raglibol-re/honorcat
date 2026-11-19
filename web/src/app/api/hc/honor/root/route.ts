import { connection } from "next/server";
import { errorResponse, getDb, honorRoots } from "@/server/relay";

/** The newest honor root: day, rules version, root, last block counted, its transaction and contract. */
export async function GET() {
  await connection();
  try {
    return Response.json({ root: await honorRoots.latestRoot(await getDb()) }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (err) {
    return errorResponse(err);
  }
}
