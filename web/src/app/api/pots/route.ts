import { connection, type NextRequest } from "next/server";
import { getDb, listPots, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await connection();
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  if (status && !["open", "resolved", "expired"].includes(status)) {
    return Response.json({ error: "invalid status" }, { status: 400 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const listedOnly = req.nextUrl.searchParams.get("scope") === "guarantees";
  const pots = await listPots(await getDb(), { status, limit, listedOnly });
  nudgeRelay("api:pots");
  return Response.json({ pots });
}
