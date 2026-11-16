import { connection } from "next/server";
import { z } from "zod";
import { address, createDraft, errorResponse, getDb } from "@/server/relay";

const body = z.object({ account: address, kind: z.enum(["passkey", "wallet"]) });

/** Starts a shared draft; returns its id and the host's seat token (kept in the host's browser). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await createDraft(await getDb(), b));
  } catch (err) {
    return errorResponse(err);
  }
}
