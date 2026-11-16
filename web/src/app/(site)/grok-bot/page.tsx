import Link from "next/link";
import { C, F } from "@/components/cat/tokens";
import { HelperCat } from "@/components/helper/Helper";
import { SITE_URL } from "@/lib/site";
import { CopyBlock } from "./CopyBlock";

export const metadata = { title: "Invite your Grok Bot" };

const h2: React.CSSProperties = { margin: 0, fontFamily: F.cond, fontSize: 34, fontWeight: 600 };
const p: React.CSSProperties = { margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body, maxWidth: 720 };

const JOB = `You are my HonorCat agent, connected through the "honorcat" connector. HonorCat is a test version on Arc testnet: test money only.

Your jobs:
1. AI opponent. When I say "take my HonorCat invite", call list_my_pots, pick the newest invitation, and call take_side. Then play the pot: read_pot every few minutes, and when you act, use set_net, set_bowl, request_exit or offer_handshake.
2. Cat sitter. When I say "mind my HonorCat pot", call list_my_pots and read the pot I let you mind. Act only within the powers I gave you; anything that needs my approval becomes a proposal I confirm in HonorCat.
3. Advice, only when I ask. Use search_markets and market_price (data provided by Gemini) and your own web and X search. Say clearly that it is your opinion, give your sources, and never act on advice without my word.

Rules:
- Give every action a one-line reason (the "reason" field); I see it on the pot page.
- An exit is final: it is priced by the next 30 seconds. Never leave just because the price wobbles.
- Play fair: no rushing, no spamming actions; at most one action every few minutes per pot.
- If a tool refuses, tell me what it said and stop; do not try another way around.`;

/** How a person invites their Grok Bot (xAI's agent) to HonorCat through our MCP connector. */
export default function GrokBotPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 820 }}>
      <header style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
        <HelperCat pose="talk" size={110} label="The helper cat explaining how to invite your Grok Bot" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Invite your Grok Bot</h1>
          <p style={p}>
            Grok Bot, xAI&apos;s always-on agent, can sit at your HonorCat table: as an AI opponent on your practice pots when nobody else is around, or as a cat sitter minding your own pots with the
            powers you choose. It reaches HonorCat through a connector, uses your own Grok Bot plan, and never holds your keys or withdraws.
          </p>
        </div>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>1. Give it a seat</h2>
        <p style={p}>
          On <Link href="/account#agents">your account page</Link>, under “Your Grok Bot”, choose “Give my Grok Bot a seat” and confirm. You see a secret token once. A seat lasts 24 hours, plays
          test pots up to $2 as your opponent, and stops the moment you revoke it.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>2. Connect HonorCat in Grok Bot</h2>
        <p style={p}>In Grok Bot open Connect apps → Add a custom connector, and fill in:</p>
        <ul style={{ ...p, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            Name: <strong>honorcat</strong>; Type: <strong>Remote HTTPS</strong>
          </li>
          <li>
            Server URL: <CopyBlock value={`${SITE_URL}/api/mcp`} />
          </li>
          <li>
            HTTP header: name <strong>Authorization</strong>, value <strong>Bearer</strong> followed by your seat&apos;s token (copy it from the account page when you create the seat).
          </li>
        </ul>
        <p style={p}>Then choose Add plugin. Grok Bot now sees HonorCat&apos;s tools: your invitations and minded pots, reading a pot, taking a side, nets, bowls, exits, handshakes, and read-only market search.</p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>3. Paste its job description</h2>
        <p style={p}>Paste this into your Grok Bot (as its instructions, or as your first message):</p>
        <CopyBlock value={JOB} multiline />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>4. Play</h2>
        <ul style={{ ...p, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong>Against your Grok Bot:</strong> on <Link href="/pots/new?practice=1">Start a pot</Link>, tick “Practise alone”, choose “my Grok Bot”, give your word, then tell your Bot “take my HonorCat
            invite”.
          </li>
          <li>
            <strong>As your cat sitter:</strong> on one of your live pots, choose “Let my cat sitter mind this pot”, pick what it may do alone (exits you sign in advance) and what waits for you (nets,
            bowls, handshakes), then tell your Bot “mind my HonorCat pot”.
          </li>
        </ul>
        <p style={{ ...p, fontSize: 15, color: C.muted }}>
          Every agent action shows on the pot page with its reason. Pots with an agent stay out of honor records. Test version on Arc testnet: test money only. Not financial advice.
        </p>
      </section>
    </div>
  );
}
