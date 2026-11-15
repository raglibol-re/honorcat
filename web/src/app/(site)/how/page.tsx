import Link from "next/link";
import { CatHead } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";

export const metadata = { title: "How it works" };

const steps: [string, React.ReactNode][] = [
  [
    "Fill the bowl",
    <>
      Pick any live Gemini market, the outcome and how likely it must become (85% by default). Sign once in your wallet; there are no network
      fees. The money is held on Arc, a public payment network where anyone can see it.
    </>,
  ],
  [
    "Call your people",
    <>
      Share the link. People join with a passkey (Face ID, a fingerprint or the phone PIN). No wallet, no forms, nothing to pay. Joining is open
      for a set time; after that the market is watched.
    </>,
  ],
  [
    "The cat pounces",
    <>
      Three independent checkers read Gemini’s public order book every few seconds. A reading only counts when the market is healthy: a small
      gap between buy and sell prices, enough contracts on both sides and fresh data. The chance must stay above the line on average over a full
      time window, and two of the three checkers must each see this in their own data. A single price spike never pays. These rules are fixed
      when the money is set aside and cannot change afterwards.
    </>,
  ],
];

const details: [string, React.ReactNode][] = [
  [
    "If it never gets that likely",
    <>
      The funder chooses beforehand: either the money goes back to them when trading closes, or everyone is still paid when the market settles if
      the event happened (otherwise it goes back to the funder).
    </>,
  ],
  [
    "An early payout is final",
    <>Markets can be wrong. If the event does not happen after all, nobody pays anything back; the page says “market was wrong”.</>,
  ],
  [
    "Edge cases",
    <ul key="edge" style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 6 }}>
      <li>Bad or missing market data never pays. A data outage that lasts until trading closes counts as “not reached”.</li>
      <li>While Gemini reviews a market, nothing can pay early.</li>
      <li>Market voided before a payout: the funder gets everything back. After a payout: the payout stands.</li>
      <li>If your account cannot receive money, your amount stays reserved for you to collect later.</li>
    </ul>,
  ],
  [
    "Can I check it?",
    <>
      Yes. Every payout page has a proof page with every reading and signature, recomputed in your browser. Payments are public on Arc. Builders
      can read the <Link href="/developers">developer docs</Link>.
    </>,
  ],
  ["Is this real money?", <>No. This is a test version with test money on Arc testnet. It is not insurance and no hedge is placed.</>],
];

const cond = { fontFamily: F.cond } as const;

export default function HowPage() {
  return (
    <article style={{ display: "flex", flexDirection: "column", gap: 64 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 680 }}>
        <h1 style={{ margin: 0, ...cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>How it works</h1>
        <p style={{ margin: 0, fontSize: 21, lineHeight: 1.45, color: C.body }}>
          Someone sets money aside for a group. Everyone is paid at once, automatically, as soon as a live Gemini market says the event has become
          very likely, before it happens. Afterwards the page records whether the market was right.
        </p>
      </div>

      <ol style={{ display: "flex", flexDirection: "column", borderBottom: `1px solid ${C.ink}`, margin: 0, padding: 0, listStyle: "none" }}>
        {steps.map(([title, body], i) => (
          <li key={title} style={{ display: "flex", gap: 32, padding: "28px 0", borderTop: `1px solid ${C.ink}`, alignItems: "flex-start" }}>
            <span style={{ ...cond, fontSize: 84, fontWeight: 600, lineHeight: 0.85, flex: "0 0 56px" }}>{i + 1}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontFamily: F.sans, fontSize: 26, fontWeight: 600, lineHeight: 1.15 }}>{title}</h2>
              <p style={{ margin: 0, fontSize: 18, lineHeight: 1.5, color: C.body, maxWidth: 620 }}>{body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2 style={{ margin: 0, ...cond, fontSize: 44, fontWeight: 600, lineHeight: 1 }}>The fine print</h2>
        <dl style={{ margin: 0, display: "flex", flexDirection: "column", borderTop: `1.5px solid ${C.ink}`, borderBottom: `1.5px solid ${C.ink}` }}>
          {details.map(([title, body], i) => (
            <div key={title} style={{ display: "flex", flexWrap: "wrap", gap: "6px 32px", padding: "18px 0", borderTop: i ? `1px solid ${C.faint}` : undefined }}>
              <dt style={{ flex: "0 1 260px", display: "flex", alignItems: "center", gap: 10, alignSelf: "flex-start", fontSize: 18, fontWeight: 600 }}>
                <CatHead width={18} height={17} />
                {title}
              </dt>
              <dd style={{ flex: "1 1 360px", margin: 0, fontSize: 17, lineHeight: 1.5, color: C.body, maxWidth: 620 }}>{body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div>
        <Link
          href="/early/new"
          style={{ display: "inline-flex", alignItems: "center", gap: 14, minHeight: 68, padding: "8px 28px 8px 22px", background: C.ink, color: C.page, textDecoration: "none" }}
        >
          <CatHead width={34} height={32} fill={C.page} eyes={C.ink} />
          <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.15 }}>Let the cat out</span>
            <span style={{ fontSize: 15, fontWeight: 500, lineHeight: 1.2, color: C.faint }}>Run the demo</span>
          </span>
        </Link>
      </div>
    </article>
  );
}
