import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, posts } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const base = { postId: z.string().regex(/^\d{1,18}$/), account: address, issuedAt: z.string().min(10).max(40) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** Deletes one of your own posts (signed). */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await posts.deletePost(await getDb(), b as Parameters<typeof posts.deletePost>[1]));
  } catch (err) {
    return errorResponse(err);
  }
}
