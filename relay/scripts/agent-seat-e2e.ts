/**
 * End to end against production: a throwaway player creates an agent seat (signed), an MCP client
 * connects with the seat token exactly as Grok Bot's custom connector does, lists the tools, calls
 * read-only ones, is refused an action it may not take, then the seat is revoked and the next call
 * fails at once. Moves no money. Usage: tsx scripts/agent-seat-e2e.ts [base URL]
 */
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const BASE = process.argv[2] ?? "https://honorcat.vercel.app";
const player = privateKeyToAccount(generatePrivateKey());
const now = () => new Date().toISOString();
const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.text() };
};
const ok = (cond: boolean, what: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${what}`);
  if (!cond) process.exitCode = 1;
};

// 1. Create a seat, signed by the player.
let issuedAt = now();
const label = "e2e Grok Bot";
const created = await post("/api/hc/agent/seats", {
  action: "create",
  account: player.address,
  label,
  issuedAt,
  signature: await player.signMessage({ message: `HonorCat: let my agent "${label}" play my practice pots.\nAccount: ${getAddress(player.address)}\nIssued: ${issuedAt}` }),
});
const seat = JSON.parse(created.body) as { id: string; token: string };
ok(created.status === 200 && seat.token?.startsWith("hcs_"), `seat created (${created.status})`);

// 2. MCP over Streamable HTTP, as a remote connector does.
const mcp = (method: string, params: unknown, id: number, token = seat.token) =>
  post("/api/mcp", { jsonrpc: "2.0", id, method, params }, { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" });
const parse = (b: string) => {
  const line = b.split("\n").find((l) => l.startsWith("data:"));
  return JSON.parse(line ? line.slice(5) : b);
};
const init = await mcp("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } }, 1);
ok(init.status === 200 && /honorcat/.test(init.body), `initialize (${init.status})`);
const list = await mcp("tools/list", {}, 2);
const tools = (parse(list.body).result?.tools ?? []).map((t: { name: string }) => t.name);
ok(["list_my_pots", "read_pot", "take_side", "set_net", "request_exit", "search_markets"].every((t) => tools.includes(t)), `tools listed: ${tools.join(", ")}`);
ok(!tools.some((t: string) => /withdraw|create_pot|transfer/.test(t)), "no tool can withdraw, create real pots or transfer");
const mine = await mcp("tools/call", { name: "list_my_pots", arguments: {} }, 3);
ok(/invites/.test(mine.body), "list_my_pots answers");
const markets = await mcp("tools/call", { name: "search_markets", arguments: { limit: 3 } }, 4);
ok(/Data provided by Gemini/.test(markets.body), "search_markets answers, credited to Gemini");
const refused = await mcp("tools/call", { name: "set_net", arguments: { potId: "1", percent: 40, reason: "testing a refusal" } }, 5);
ok(/Refused/.test(refused.body), "an action outside the seat's pots is refused");
// The same through the one-link form a player pastes into Grok Bot (no header).
const viaLink = (method: string, params: unknown, id: number) =>
  post(`/api/mcp/${seat.token}`, { jsonrpc: "2.0", id, method, params }, { accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" });
const linkList = await viaLink("tools/list", {}, 61);
ok(linkList.status === 200 && /list_my_pots/.test(linkList.body), `the connector link works without a header (${linkList.status})`);
const bad = await mcp("tools/list", {}, 6, "hcs_notarealtokennotarealtoken");
ok(bad.status === 401, `an unknown token gets 401 (${bad.status})`);

// 3. Revoke; the very next call fails.
issuedAt = now();
const rev = await post("/api/hc/agent/seats", {
  action: "revoke",
  account: player.address,
  seatId: seat.id,
  issuedAt,
  signature: await player.signMessage({ message: `HonorCat: revoke agent seat ${seat.id}.\nAccount: ${getAddress(player.address)}\nIssued: ${issuedAt}` }),
});
ok(rev.status === 200, `seat revoked (${rev.status})`);
const after = await mcp("tools/list", {}, 7);
ok(after.status === 401, `a revoked seat gets 401 at once (${after.status})`);
const afterLink = await viaLink("tools/list", {}, 8);
ok(afterLink.status === 401, `the revoked seat's link gets 401 at once (${afterLink.status})`);
