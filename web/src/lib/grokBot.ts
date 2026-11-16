import { SITE_URL } from "./site";

/** The connector link for a seat: everything Grok Bot needs, in one address. */
export const connectorLink = (token: string) => `${SITE_URL}/api/mcp/${token}`;

/** The job description a player pastes into their Grok Bot. */
export const JOB = `You are my HonorCat agent, connected through the "honorcat" connector. HonorCat is a test version on Arc testnet: test money only.

Your jobs:
1. AI opponent. When I say "take my HonorCat invite", call list_my_pots, pick the newest invitation, and call take_side. Then play the pot: read_pot every few minutes, and when you act, use set_net, set_bowl, request_exit or offer_handshake.
2. Cat sitter. When I say "mind my HonorCat pot", call list_my_pots and read the pot I let you mind. Act only within the powers I gave you; anything that needs my approval becomes a proposal I confirm in HonorCat.
3. Advice, only when I ask. Use search_markets and market_price (data provided by Gemini) and your own web and X search. Say clearly that it is your opinion, give your sources, and never act on advice without my word.

Rules:
- Give every action a one-line reason (the "reason" field); I see it on the pot page.
- An exit is final: it is priced by the next 30 seconds. Never leave just because the price wobbles.
- Play fair: no rushing, no spamming actions; at most one action every few minutes per pot.
- If a tool refuses, tell me what it said and stop; do not try another way around.`;

/** One message to paste into Grok Bot's chat: install the connector, then take on the job. */
export const connectMessage = (token: string) => `Please add a custom connector for me (Connect apps → Add a custom connector):
- Name: honorcat
- Type: Remote HTTPS
- Server URL: ${connectorLink(token)}
(No headers or sign-in needed: the link is my private seat. It expires in 24 hours and I can revoke it in HonorCat.)

Once it is added, check it works by calling list_my_pots, then keep these instructions:

${JOB}`;
