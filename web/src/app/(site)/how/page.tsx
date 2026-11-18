import Link from "next/link";
import { C, F } from "@/components/cat/tokens";

export const metadata = { title: "How it works" };

const cond = { fontFamily: F.cond } as const;

const steps: [string, React.ReactNode][] = [
  [
    "Pick a question and a side",
    <>
      Choose a live Gemini prediction market, say “Cleveland beats Chicago”, and a side: it happens, or it does not. You enter only what you put in; the other
      side puts in theirs when they join, so the pot is up to $25 on the test version. A passkey is enough: no app, no seed words, no network fees.
    </>,
  ],
  [
    "The price sets the shares",
    <>
      The chance is the midpoint of Gemini&apos;s best bid and ask, counted only when the book is healthy, and averaged over 30 seconds. The side that says it happens
      holds the pot times that chance; the other side holds the rest. The cat on the rope stands at that price. Shares are only shown; nothing moves until someone leaves or the
      market settles.
    </>,
  ],
  [
    "Step off or hold on",
    <>
      Either side can leave at any time. Leaving is binding, and the price is measured over the 30 seconds after you ask, so nobody can leave at a price they
      already know is stale. You pay a 1% fee to the other side. Hold on instead, and Gemini&apos;s result decides who gets the pot.
    </>,
  ],
];

const details: [string, React.ReactNode][] = [
  [
    "Who measures the price",
    <>
      Three independent samplers read Gemini&apos;s public order book on their own and each signs its own average. With three valid averages the middle one counts;
      with two, their mean if they are within half a point; otherwise nothing moves and the pot simply continues. The pot contract checks two of three signatures.
    </>,
  ],
  [
    "Joining",
    <>
      The joiner puts in its worst case within the creator&apos;s band (up to 5 points from the price when the pot was offered). The starting shares are the average
      over the 30 seconds after the join; whatever is above a side&apos;s share comes straight back. If the price left the band, the join does not happen.
    </>,
  ],
  [
    "Extras",
    <ul key="x" style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
      <li>A net leaves for you when your side&apos;s price falls to a level; a bowl when it rises to one. Both are priced like any exit.</li>
      <li>Nine lives: leave a ninth of the starting pot at a time.</li>
      <li>Handshake: both sides agree to split now at a price, with no fee and no waiting.</li>
      <li>Takeover: while a side is leaving, someone else can step into its place at the exit price.</li>
      <li>Sides are tokens: whoever holds one holds the side.</li>
    </ul>,
  ],
  [
    "When leaving is closed",
    <>In the last minutes before the market closes, while Gemini has halted or is reviewing the market, and while another exit is being priced.</>,
  ],
  [
    "If nobody settles",
    <>If Gemini&apos;s result is not confirmed within 3 days after the close (the default), anyone can close the pot and both deposits go back.</>,
  ],
  [
    "Can I check it?",
    <>
      Every pot has a terms page with its own numbers and a proof page with every sampler&apos;s average and evidence hash. Payments are public on Arc. See also{" "}
      <Link href="/how-it-is-built">how it is built</Link> and the <Link href="/developers">developer docs</Link>.
    </>,
  ],
  ["Is this real money?", <>No. This is a test version with test money on Arc testnet. Not financial advice; play within limits.</>],
];

export default function HowPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 48, maxWidth: 860 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, ...cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>How it works</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>Two sides, one pot, one question on Gemini. The money is in the air until someone steps off or the market lands.</p>
      </div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none", borderBottom: `1px solid ${C.ink}` }}>
        {steps.map(([title, body], i) => (
          <li key={title} style={{ display: "flex", gap: 28, padding: "24px 0", borderTop: `1px solid ${C.ink}`, alignItems: "flex-start" }}>
            <span style={{ ...cond, fontSize: 72, fontWeight: 600, lineHeight: 0.85, flex: "0 0 48px" }}>{i + 1}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <h2 style={{ margin: 0, fontFamily: F.sans, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{title}</h2>
              <p style={{ margin: 0, fontSize: 18, lineHeight: 1.55, color: C.body }}>{body}</p>
            </div>
          </li>
        ))}
      </ol>
      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>The fine print</h2>
        <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          {details.map(([k, v]) => (
            <div key={k} style={{ borderTop: `1px solid ${C.faint}`, paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
              <dt style={{ fontSize: 19, fontWeight: 600 }}>{k}</dt>
              <dd style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body }}>{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
