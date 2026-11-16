import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, namesOf, setName } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const body = z.union([
  z.object({ account: address, name: z.string().min(1).max(60), issuedAt: z.string().min(10), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }),
  z.object({ account: address, name: z.string().min(1).max(60), issuedAt: z.string().min(10), passkey: assertionBody }),
]);

/** Display names for ?accounts=0x…,0x… (public). */
export async function GET(req: Request) {
  await connection();
  try {
    const accounts = (new URL(req.url).searchParams.get("accounts") ?? "").split(",").filter(Boolean);
    return Response.json({ names: await namesOf(await getDb(), accounts) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** An account sets its own display name, proven by its signature. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await setName(await getDb(), b as never));
  } catch (err) {
    return errorResponse(err);
  }
}
