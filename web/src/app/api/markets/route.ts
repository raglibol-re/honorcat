import { connection, type NextRequest } from "next/server";
import { marketsFor, TEMPLATE_INFO, type Template } from "@/server/guarantees";

const TEMPLATES = Object.keys(TEMPLATE_INFO) as Template[];

/** Live Gemini markets for a guarantee template, with market-price estimates per contract. */
export async function GET(req: NextRequest) {
  await connection();
  const t = req.nextUrl.searchParams.get("template") as Template | null;
  if (!t || !TEMPLATES.includes(t)) return Response.json({ error: `template must be one of ${TEMPLATES.join(", ")}` }, { status: 400 });
  try {
    const markets = await marketsFor(t);
    return Response.json({ template: t, info: TEMPLATE_INFO[t], markets, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: `Gemini is unavailable: ${(err as Error).message}` }, { status: 502 });
  }
}
