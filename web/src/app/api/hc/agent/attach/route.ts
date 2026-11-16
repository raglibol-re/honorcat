import { connection } from "next/server";
import { z } from "zod";
import { address, attachSitter, detachSitter, errorResponse, getDb } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const power = z.enum(["alone", "approval", "off"]);
const exit = z.object({ sig: z.string().regex(/^0x[0-9a-fA-F]+$/), notional: z.string().regex(/^\d+$/), deadline: z.number().int() }).nullish();
const body = z.intersection(
  z.object({
    account: address,
    seatId: z.string().max(40),
    potId: z.string().regex(/^\d+$/),
    issuedAt: z.string().min(10),
    powers: z.object({ setNet: power, setBowl: power, partialExit: power, fullExit: power, acceptHandshake: power }),
    exits: z.object({ full: exit, partial: exit }).optional(),
  }),
  z.union([z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ passkey: assertionBody })]),
);

/** The player attaches a cat sitter to one of their own live pots (signed), with powers per action. */
export async function POST(req: Request) {
  await connection();
  try {
    return Response.json(await attachSitter(await getDb(), body.parse(await req.json()) as never));
  } catch (err) {
    return errorResponse(err);
  }
}

/** The player sends the sitter away from this pot. */
export async function DELETE(req: Request) {
  await connection();
  try {
    const { potId, account } = z.object({ potId: z.string().regex(/^\d+$/), account: address }).parse(await req.json());
    await detachSitter(await getDb(), potId, account);
    return Response.json({ detached: potId });
  } catch (err) {
    return errorResponse(err);
  }
}
