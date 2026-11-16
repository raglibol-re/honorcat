import Link from "next/link";
import { ConnectGrokBot } from "@/components/agent/ConnectGrokBot";
import { C, F } from "@/components/cat/tokens";
import { HelperCat } from "@/components/helper/Helper";
import { JOB } from "@/lib/grokBot";
import { CopyBlock } from "./CopyBlock";

export const metadata = { title: "Invite your Grok Bot" };

const h2: React.CSSProperties = { margin: 0, fontFamily: F.cond, fontSize: 34, fontWeight: 600 };
const p: React.CSSProperties = { margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body, maxWidth: 720 };

/** How a person invites their Grok Bot (xAI's agent) to HonorCat: one click, one paste. */
export default function GrokBotPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 32, maxWidth: 820 }}>
      <header style={{ display: "flex", alignItems: "flex-end", gap: 18 }}>
        <HelperCat pose="talk" size={110} label="The helper cat explaining how to invite your Grok Bot" />
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Invite your Grok Bot</h1>
          <p style={p}>
            Grok Bot, xAI&apos;s always-on agent, can sit at your HonorCat table: as an AI opponent on your practice pots when nobody else is around, or as a cat sitter minding your own pots with the
            powers you choose. It uses your own Grok Bot plan, never holds your keys and never withdraws.
          </p>
        </div>
      </header>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>1. Connect</h2>
        <ConnectGrokBot />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>2. Paste into Grok Bot</h2>
        <p style={p}>
          Paste the copied message into a chat with your Grok Bot. It adds HonorCat as a connector and checks it works. Its tools: your invitations and minded pots, reading a pot, taking a side, nets,
          bowls, exits, handshakes, and read-only market search with data provided by Gemini.
        </p>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h2 style={h2}>3. Play</h2>
        <ul style={{ ...p, paddingLeft: 22, display: "flex", flexDirection: "column", gap: 8 }}>
          <li>
            <strong>Against your Grok Bot:</strong> on <Link href="/pots/new?practice=1">Start a pot</Link>, tick “Practise alone”, choose “my Grok Bot”, give your word, then tell your Bot “take my HonorCat
            invite”.
          </li>
          <li>
            <strong>As your cat sitter:</strong> on one of your live pots, choose “Let my cat sitter mind this pot”, pick what it may do alone (exits you sign in advance) and what waits for you (nets,
            bowls, handshakes), then tell your Bot “mind my HonorCat pot”.
          </li>
          <li>
            <strong>Advice:</strong> ask it about a market; it reads HonorCat&apos;s live market data and searches on its own, and marks its answer as its opinion.
          </li>
        </ul>
        <p style={{ ...p, fontSize: 15, color: C.muted }}>
          Every agent action shows on the pot page with its reason. Pots with an agent stay out of honor records. Your seats: <Link href="/account#agents">account page</Link>. Test version on Arc testnet: test
          money only. Not financial advice.
        </p>
      </section>

      <details>
        <summary style={{ cursor: "pointer", fontSize: 16, minHeight: 32 }}>The job description on its own</summary>
        <div style={{ paddingTop: 10 }}>
          <CopyBlock value={JOB} multiline />
        </div>
      </details>
    </div>
  );
}
