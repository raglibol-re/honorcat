import { connection } from "next/server";
import { z } from "zod";
import { addNote, address, errorResponse, getDb, notesOf } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const base = { account: address, kind: z.enum(["well_played", "rematch"]), draftId: z.string().max(40).nullish(), issuedAt: z.string().min(10) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** "Well played" and rematch offers on an ended pot (public). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) throw Object.assign(new Error("bad pot id"), { status: 400 });
    return Response.json({ notes: await notesOf(await getDb(), id) }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** A player of the pot sends "Well played" or offers a rematch, signed. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) throw Object.assign(new Error("bad pot id"), { status: 400 });
    const b = body.parse(await req.json());
    return Response.json({ notes: await addNote(await getDb(), { ...b, potId: id } as Parameters<typeof addNote>[1]) });
  } catch (err) {
    return errorResponse(err);
  }
}
