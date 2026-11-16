import { connection } from "next/server";
import { mcpForToken } from "@/server/mcp";

export const maxDuration = 60;

/** HonorCat's MCP endpoint with the seat token in the header: `Authorization: Bearer <token>`. */
async function handle(req: Request) {
  await connection();
  return mcpForToken(req, req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim());
}

export { handle as GET, handle as POST, handle as DELETE };
