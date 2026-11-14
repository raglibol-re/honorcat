import { connection } from "next/server";
import { getDb, guaranteeDetail } from "@/server/relay";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One-line embed for a checkout page: "Refund guarantee · 5.00 USDC · locked on Arc". */
export async function GET(_req: Request, ctx: RouteContext<"/api/guarantees/[id]/badge">) {
  await connection();
  const { id } = await ctx.params;
  const d = await guaranteeDetail(await getDb(), id);
  const amount = d ? (Number(d.guarantee.refund) / 1e6).toFixed(2) : "—";
  const text = d ? `Refund guarantee · ${amount} USDC · locked on Arc` : "Refund guarantee";
  const width = 22 + text.length * 6.6;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="28" role="img" aria-label="${esc(text)}">
  <rect x="0.5" y="0.5" rx="14" width="${(width - 1).toFixed(0)}" height="27" fill="#e2f0ed" stroke="#0a6a62"/>
  <text x="14" y="18" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="12" fill="#0a6a62">${esc(text)}</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" } });
}
