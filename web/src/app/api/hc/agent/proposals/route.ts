import { connection } from "next/server";
import { z } from "zod";
import { decideProposal, errorResponse, getDb } from "@/server/relay";

/**
 * Marks a cat sitter's proposal approved (after the player's own transaction went through) or
 * declined. It moves no money: an approved action is always the player's own signed transaction.
 */
export async function POST(req: Request) {
  await connection();
  try {
    const { id, decision } = z.object({ id: z.string().regex(/^\d+$/), decision: z.enum(["approved", "declined"]) }).parse(await req.json());
    return Response.json(await decideProposal(await getDb(), id, decision));
  } catch (err) {
    return errorResponse(err);
  }
}
