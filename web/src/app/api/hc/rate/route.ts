import { connection } from "next/server";
import { errorResponse, eurRate } from "@/server/relay";

/** The USDC to EURC rate for showing amounts in euros (Circle Swap Kit token rates; display only). */
export async function GET() {
  await connection();
  try {
    return Response.json({ rate: await eurRate() }, { headers: { "cache-control": "public, max-age=300, s-maxage=600" } });
  } catch (err) {
    return errorResponse(err);
  }
}
