import { connection } from "next/server";
import { z } from "zod";
import { errorResponse, getDb, inviteAgent, pots } from "@/server/relay";

/**
 * Marks an open pot for its creator's own agent ("play against my Grok Bot"). Needs no signature:
 * only the creator's own seat can take the side, and only within its limits.
 */
export async function POST(req: Request) {
  await connection();
  try {
    const { potId } = z.object({ potId: z.string().regex(/^\d+$/) }).parse(await req.json());
    const db = await getDb();
    const d = await pots.potDetail(db, potId);
    if (!d || d.state !== "Open") return Response.json({ error: "only open pots can be offered to an agent" }, { status: 409 });
    const creator = Number(d.data.creatorSide) === 0 ? d.owners.yes : d.owners.no;
    if (!creator) return Response.json({ error: "no creator" }, { status: 409 });
    await inviteAgent(db, potId, creator);
    return Response.json({ invited: potId });
  } catch (err) {
    return errorResponse(err);
  }
}
