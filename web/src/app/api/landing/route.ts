import { connection } from "next/server";
import { landingData } from "@/server/landing";

export const maxDuration = 30;

/** The landing page's live data (polled by the page); see server/landing.ts. */
export async function GET() {
  await connection();
  return Response.json(await landingData(), { headers: { "cache-control": "no-store" } });
}
