import { createMcpHandler } from "mcp-handler";
import { connection } from "next/server";
import { z } from "zod";
import { catalogList, liveQuality } from "@/server/catalog";
import { getDb, seatAct, seatByToken, type Seat } from "@/server/relay";
import { sidesOf } from "@/lib/statement";

export const maxDuration = 60;

/**
 * HonorCat as tools for a player's agent (their Grok Bot, added as a custom "Remote HTTPS" connector
 * with the header `Authorization: Bearer <seat token>`). Every request is checked against the seat
 * (revoked or expired seats get 401 at once); every tool goes through `seatAct`, which re-checks the
 * seat, enforces its action list, limits and per-pot powers, and logs the call with the agent's
 * reason. No tool can withdraw, create real pots or change account settings. Testnet only.
 */
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 1) }] });
const reason = z.string().min(3).max(140).describe("Your one-line reason, shown to the player on the pot page.");
const potId = z.string().regex(/^\d+$/).describe("The pot number, e.g. \"23\".");

function handlerFor(seat: Seat) {
  const act = async (action: string, args: Record<string, unknown>) => {
    try {
      return text(await seatAct(await getDb(), seat.id, action, args));
    } catch (e) {
      return { ...text(`Refused: ${(e as Error).message}`), isError: true };
    }
  };
  return createMcpHandler(
    (server) => {
      server.registerTool(
        "list_my_pots",
        { title: "My invitations and minded pots", description: "Open practice pots your player invited you to (you may take the other side), and your player's own pots you mind as their cat sitter, with the powers they gave you.", inputSchema: z.object({}) },
        async () => act("list_invites", {}),
      );
      server.registerTool(
        "read_pot",
        { title: "Read a pot", description: "A pot's state, market, sides, shares and its onchain events.", inputSchema: z.object({ potId }) },
        async ({ potId }) => act("read_pot", { potId }),
      );
      server.registerTool(
        "take_side",
        { title: "Take the other side", description: "Take the other side of a practice pot your player invited you to (test money, up to the seat's limit).", inputSchema: z.object({ potId, reason }) },
        async (a) => act("take_side", a),
      );
      server.registerTool(
        "set_net",
        { title: "Set a net", description: "A net at this percentage of the side's own price. On your player's own pot this becomes a proposal they confirm.", inputSchema: z.object({ potId, percent: z.number().gt(0).lt(100), reason }) },
        async (a) => act("set_net", a),
      );
      server.registerTool(
        "set_bowl",
        { title: "Set a bowl", description: "A bowl at this percentage of the side's own price. On your player's own pot this becomes a proposal they confirm.", inputSchema: z.object({ potId, percent: z.number().gt(0).lt(100), reason }) },
        async (a) => act("set_bowl", a),
      );
      server.registerTool(
        "request_exit",
        {
          title: "Request an exit",
          description: "Leave with the whole share (part \"full\") or the agreed part (\"partial\"). Final: priced by the next 30 seconds. On your player's pot you act alone only if they signed that exit in advance; otherwise it is a proposal.",
          inputSchema: z.object({ potId, part: z.enum(["full", "partial"]).default("full"), reason }),
        },
        async (a) => act("request_exit", a),
      );
      server.registerTool(
        "offer_handshake",
        { title: "Offer a handshake", description: "In a practice pot where you hold a side: offer to split now at the last measured price, no fee.", inputSchema: z.object({ potId, reason }) },
        async (a) => act("offer_handshake", a),
      );
      server.registerTool(
        "accept_handshake",
        { title: "Accept a handshake", description: "Accept the other side's handshake offer. On your player's own pot this becomes a proposal they confirm.", inputSchema: z.object({ potId, reason }) },
        async (a) => act("accept_handshake", a),
      );
      server.registerTool(
        "search_markets",
        {
          title: "Search Gemini markets",
          description: "Read-only: live Gemini prediction markets HonorCat can use, with the statement each side stands for, the current chance and whether the order book works. Data provided by Gemini.",
          inputSchema: z.object({ query: z.string().max(80).optional(), even: z.boolean().optional().describe("Only markets between 40% and 60%."), limit: z.number().int().min(1).max(20).default(8) }),
        },
        async ({ query, even, limit }) => {
          const r = await catalogList(await getDb(), { q: query ?? null, even: !!even, usable: true, limit });
          return text({
            markets: r.items.map((m) => {
              const s = sidesOf(m);
              const bid = m.book?.bid ?? m.bid;
              const ask = m.book?.ask ?? m.ask;
              return { symbol: m.symbol, yes: s.yes, no: s.no, chance: bid != null && ask != null ? Math.round(((bid + ask) / 2) * 1000) / 10 : null, closes: new Date(m.closeMs).toISOString(), works: m.quality.status };
            }),
            source: "Data provided by Gemini.",
          });
        },
      );
      server.registerTool(
        "market_price",
        { title: "A market's live price", description: "Read-only: the live order book of one Gemini market (bid, ask, chance). Data provided by Gemini.", inputSchema: z.object({ symbol: z.string().regex(/^GEMI-[A-Z0-9.-]+$/i) }) },
        async ({ symbol }) => {
          const r = await liveQuality(await getDb(), symbol);
          const b = r.book;
          return text({ symbol, bid: b?.bid ?? null, ask: b?.ask ?? null, chance: b?.bid != null && b?.ask != null ? Math.round(((b.bid + b.ask) / 2) * 1000) / 10 : null, works: r.quality?.status ?? null, source: "Data provided by Gemini." });
        },
      );
    },
    { serverInfo: { name: "honorcat", version: "1.0.0" } },
  );
}

async function handle(req: Request) {
  await connection();
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const seat = await seatByToken(await getDb(), token);
  if (!seat) return Response.json({ error: "This agent seat is unknown, revoked or expired. Create a new seat on your HonorCat account page." }, { status: 401 });
  return handlerFor(seat)(req);
}

export { handle as GET, handle as POST, handle as DELETE };
