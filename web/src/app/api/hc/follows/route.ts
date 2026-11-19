import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, social } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

/** Who ?account= follows, and how many follow it (public). */
export async function GET(req: Request) {
  await connection();
  try {
    const a = address.parse(new URL(req.url).searchParams.get("account"));
    return Response.json(await social.followsOf(await getDb(), a), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const base = { account: address, leader: address, follow: z.boolean(), issuedAt: z.string().min(10) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** Follow or stop following a player, signed by the follower. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await social.setFollow(await getDb(), b as Parameters<typeof social.setFollow>[1]));
  } catch (err) {
    return errorResponse(err);
  }
}
