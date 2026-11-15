import { connection } from "next/server";
import { demoCandidates } from "@/server/early";

export const maxDuration = 30;

/** Live Gemini contracts best suited for a demo right now: one that should trigger, one that should refund. */
export async function GET(req: Request) {
  await connection();
  const bps = Number(new URL(req.url).searchParams.get("threshold") ?? 8500);
  try {
    const c = await demoCandidates(Number.isInteger(bps) && bps >= 5000 && bps <= 9900 ? bps : 8500);
    return Response.json({ ...c, fetchedAt: new Date().toISOString() }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `Gemini is unavailable: ${(err as Error).message}` }, { status: 502 });
  }
}
