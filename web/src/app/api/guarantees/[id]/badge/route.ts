import { connection } from "next/server";
import { getDb, guaranteeDetail } from "@/server/relay";
import { HONORCAT_MARK_PATH } from "@/components/brand/HonorCatMark";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One-line embed for a checkout page: "Guaranteed by HonorCat"; the embed links to the proof page. */
export async function GET(_req: Request, ctx: RouteContext<"/api/guarantees/[id]/badge">) {
  await connection();
  const { id } = await ctx.params;
  const d = await guaranteeDetail(await getDb(), id);
  const text = "Guaranteed by HonorCat";
  const label = d ? `${text}: ${(Number(d.guarantee.refund) / 1e6).toFixed(2)} USDC refund, locked on Arc` : text;
  const width = 40 + text.length * 6.9;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width.toFixed(0)}" height="28" role="img" aria-label="${esc(label)}">
  <title>${esc(label)}</title>
  <rect x="0.5" y="0.5" rx="14" width="${(width - 1).toFixed(0)}" height="27" fill="#e2f0ed" stroke="#0a6a62"/>
  <g transform="translate(11 7) scale(0.58)" fill="#0a6a62"><path d="${HONORCAT_MARK_PATH}"/></g>
  <text x="30" y="18" font-family="IBM Plex Sans, system-ui, sans-serif" font-size="12" font-weight="500" fill="#0a6a62">${text}</text>
</svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" } });
}
