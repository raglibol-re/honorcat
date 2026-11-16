import { connection } from "next/server";
import { z } from "zod";
import { actOnDraft, address, errorResponse, getDb, getDraft } from "@/server/relay";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("sit"), account: address, kind: z.enum(["passkey", "wallet"]) }),
  z.object({
    action: z.literal("terms"),
    token: z.string().min(10).max(100),
    symbol: z.string().max(120).optional(),
    label: z.string().max(200).optional(),
    notional: z.string().regex(/^\d+$/).optional(),
    hostSide: z.union([z.literal(0), z.literal(1)]).optional(),
    graceDays: z.number().optional(),
  }),
  z.object({ action: z.literal("agree"), token: z.string().min(10).max(100), version: z.number().int() }),
  z.object({ action: z.literal("created"), token: z.string().min(10).max(100), potId: z.string().regex(/^\d+$/) }),
]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    return Response.json(await getDraft(await getDb(), id), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const { id } = await ctx.params;
    return Response.json(await actOnDraft(await getDb(), id, action.parse(await req.json()) as never));
  } catch (err) {
    return errorResponse(err);
  }
}
