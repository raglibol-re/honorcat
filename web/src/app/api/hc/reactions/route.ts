import { createHash } from "node:crypto";
import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, treats } from "@/server/relay";

const potId = z.string().regex(/^-?\d{1,20}$/);

/** Gestures of the last 20 seconds at a pot's rope: ?pot=<pot id, or -perpId>. */
export async function GET(req: Request) {
  await connection();
  try {
    const pot = potId.parse(new URL(req.url).searchParams.get("pot"));
    const list = await treats.recentReactions(await getDb(), pot);
    return Response.json({ reactions: list }, { headers: { "cache-control": "public, s-maxage=2, stale-while-revalidate=3" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const body = z.object({ pot: potId, kind: z.number().int().min(0).max(2) });

/**
 * One gesture (paw up, purr, hiss) from a player or a spectator. No account needed; the sender is
 * kept only as a daily hash of their connection, to allow one gesture every 3 seconds.
 */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
    const day = new Date().toISOString().slice(0, 10);
    const who = createHash("sha256").update(`honorcat-reaction|${day}|${ip}|${req.headers.get("user-agent") ?? ""}`).digest("hex").slice(0, 24);
    const ok = await treats.react(await getDb(), b.pot, b.kind, who);
    return Response.json({ ok }, { status: ok ? 200 : 429 });
  } catch (err) {
    return errorResponse(err);
  }
}
