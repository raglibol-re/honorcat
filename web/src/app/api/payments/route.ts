import { connection, type NextRequest } from "next/server";
import { getDb, listPayments, nudgeRelay } from "@/server/relay";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  await connection();
  const params = req.nextUrl.searchParams;
  const potIdRaw = params.get("potId");
  const potId = potIdRaw === null ? undefined : Number(potIdRaw);
  if (potId !== undefined && (!Number.isSafeInteger(potId) || potId < 1)) {
    return Response.json({ error: "invalid potId" }, { status: 400 });
  }
  // scope=guarantees: only payments of listed guarantees (the product ledger). Default: everything.
  const listedOnly = params.get("scope") === "guarantees";
  const payments = await listPayments(await getDb(), { potId, limit: Number(params.get("limit") ?? 50), listedOnly });
  nudgeRelay("api:payments");
  return Response.json({ payments });
}
