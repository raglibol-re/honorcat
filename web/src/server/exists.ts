import "server-only";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getDb } from "@/server/relay";

/**
 * Renders the not-found page on the server for an unknown or failed guarantee id, so the client
 * view never starts polling an API that answers 404 (which the browser logs as a console error).
 */
export async function requireGuarantee(params: Promise<{ id: string }>) {
  await connection();
  const { id } = await params;
  const rows = await (await getDb()).query("SELECT 1 FROM guarantees WHERE id = $1 AND status <> 'failed'", [id]);
  if (rows.length === 0) notFound();
  return id;
}
