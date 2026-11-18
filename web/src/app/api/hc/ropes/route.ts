import { connection } from "next/server";
import { errorResponse, pots } from "@/server/relay";

/** Whether short ropes (HonorCat v2) are available for new pots, with their fixed rules and fees. */
export async function GET() {
  await connection();
  try {
    return Response.json(pots.ropesStatus(), { headers: { "cache-control": "public, max-age=60" } });
  } catch (err) {
    return errorResponse(err);
  }
}
