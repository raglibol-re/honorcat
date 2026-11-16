import { connection } from "next/server";
import { z } from "zod";
import { address, createSeat, errorResponse, getDb, revokeSeat, seatsOf } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const proof = z.union([z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ passkey: assertionBody })]);
const body = z.intersection(
  z.union([
    z.object({ action: z.literal("create"), account: address, label: z.string().max(60), issuedAt: z.string().min(10) }),
    z.object({ action: z.literal("revoke"), account: address, seatId: z.string().max(40), issuedAt: z.string().min(10) }),
  ]),
  proof,
);

/** A player's agent seats (?account=0x…): what each did; never the token. */
export async function GET(req: Request) {
  await connection();
  try {
    const account = new URL(req.url).searchParams.get("account") ?? "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ seats: [] });
    return Response.json({ seats: await seatsOf(await getDb(), account) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Create a seat (the token is returned once) or revoke one; both signed by the player. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json()) as Record<string, unknown>;
    const db = await getDb();
    if (b.action === "create") return Response.json(await createSeat(db, b as never), { headers: { "cache-control": "no-store" } });
    return Response.json(await revokeSeat(db, b as never));
  } catch (err) {
    return errorResponse(err);
  }
}
