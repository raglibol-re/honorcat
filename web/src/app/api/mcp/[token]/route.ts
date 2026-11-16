import { connection } from "next/server";
import { mcpForToken } from "@/server/mcp";

export const maxDuration = 60;

/**
 * The same MCP endpoint as one link: /api/mcp/<seat token>. Nothing else to paste into Grok Bot's
 * custom connector. The link is the seat's secret: it expires with the seat and stops working the
 * moment the player revokes it.
 */
async function handle(req: Request, ctx: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await ctx.params;
  return mcpForToken(req, decodeURIComponent(token));
}

export { handle as GET, handle as POST, handle as DELETE };
