import { connection } from "next/server";
import { errorResponse, getDb, refCodes } from "@/server/relay";

/** ?account=0x… gives that account's invite code; ?code=… gives the account behind a code. */
export async function GET(req: Request) {
  await connection();
  try {
    const q = new URL(req.url).searchParams;
    const db = await getDb();
    const account = q.get("account");
    if (account && /^0x[0-9a-fA-F]{40}$/.test(account)) return Response.json({ code: await refCodes.myRefCode(db, account) }, { headers: { "cache-control": "no-store" } });
    const code = q.get("code");
    if (code) {
      const a = await refCodes.accountOfRef(db, code);
      return a ? Response.json({ account: a }, { headers: { "cache-control": "public, max-age=3600" } }) : Response.json({ error: "unknown code" }, { status: 404 });
    }
    return Response.json({ error: "account or code" }, { status: 400 });
  } catch (err) {
    return errorResponse(err);
  }
}
