import { connection } from "next/server";
import { errorResponse, feeTable, getDb } from "@/server/relay";

/**
 * The average Arc network fee of each kind of pot action over the last 7 days, in USDC base units
 * (from the relay's own receipts), so pages can show the fee in cents next to every action.
 */
export async function GET() {
  await connection();
  try {
    return Response.json({ fees: await feeTable(await getDb()) }, { headers: { "cache-control": "public, max-age=300" } });
  } catch (err) {
    return errorResponse(err);
  }
}
