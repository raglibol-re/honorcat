import { z } from "zod";
import { after } from "next/server";
import { errorResponse, getDb, registerPasskey, welcome } from "@/server/relay";
import { rpIdOf } from "@/server/webauthn";

const body = z.object({
  credentialId: z.string().min(16).max(1024),
  qx: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  qy: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

/**
 * Records a new passkey's public key and returns its account address (deterministic from the key
 * and this site's RP ID; deployed later, when it first acts). Nothing is sent on-chain here.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const rec = await registerPasskey(await getDb(), {
      credentialId: input.credentialId,
      qx: input.qx as `0x${string}`,
      qy: input.qy as `0x${string}`,
      rpId: rpIdOf(req),
    });
    // A little test USDC for the new account (once, budgeted), so a first pot needs no faucet.
    after(async () => {
      const r = await welcome(await getDb(), rec.account).catch((e) => ({ sent: false, reason: (e as Error).message }));
      console.log("[drip]", rec.account, JSON.stringify(r));
    });
    return Response.json({ account: rec.account, credentialId: rec.credentialId, rpId: rec.rpId }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
