import { connection } from "next/server";
import { getDb, getPasskey } from "@/server/relay";

/** Account for a passkey credential (used when signing in on a device that synced the passkey). */
export async function GET(_req: Request, ctx: RouteContext<"/api/passkeys/[credentialId]">) {
  await connection();
  const rec = await getPasskey(await getDb(), (await ctx.params).credentialId);
  return rec
    ? Response.json({ account: rec.account, credentialId: rec.credentialId, rpId: rec.rpId })
    : Response.json({ error: "unknown passkey" }, { status: 404 });
}
