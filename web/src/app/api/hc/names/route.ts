import { connection } from "next/server";
import { z } from "zod";
import { address, catsOf, errorResponse, FURS, getDb, setName } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const fur = z.enum(FURS).nullish();
const body = z.union([
  z.object({ account: address, name: z.string().min(1).max(60), fur, issuedAt: z.string().min(10), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, name: z.string().min(1).max(60), fur, issuedAt: z.string().min(10), passkey: assertionBody }),
]);

/** Display names and cat fur colours for ?accounts=0x…,0x… (public). */
export async function GET(req: Request) {
  await connection();
  try {
    const accounts = (new URL(req.url).searchParams.get("accounts") ?? "").split(",").filter(Boolean);
    return Response.json(await catsOf(await getDb(), accounts), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** An account sets its own display name and cat, proven by its signature. Display only: never used to authorise anything. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await setName(await getDb(), b as never));
  } catch (err) {
    return errorResponse(err);
  }
}
