import { createHash } from "node:crypto";
import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, treats } from "@/server/relay";

// A pot id, "-perpId" or "g" + group id.
const body = z.object({ pot: z.string().regex(/^(-|g)?\d{1,20}$/) });

/** A viewer's heartbeat (every 30 s while the page is open); answers how many watch now. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
    const day = new Date().toISOString().slice(0, 10);
    const who = createHash("sha256").update(`honorcat-watch|${day}|${ip}|${req.headers.get("user-agent") ?? ""}`).digest("hex").slice(0, 24);
    return Response.json({ watching: await treats.watch(await getDb(), b.pot, who) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}
