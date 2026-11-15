import Link from "next/link";

export const metadata = { title: "How it works" };

const sections: [string, React.ReactNode][] = [
  [
    "The idea",
    <>
      Someone sets money aside for a group of people. Everyone in the group is paid at once, automatically, as soon as a live Gemini
      prediction market says an event has become very likely (85% by default), before it happens, so they can prepare. Afterwards the page
      records whether the market was right.
    </>,
  ],
  [
    "1. Set money aside",
    <>
      Pick any live Gemini market, the outcome and how likely it must become. Sign once in your wallet; there are no network fees. The money
      is held on Arc, a public payment network where anyone can see it.
    </>,
  ],
  [
    "2. People join",
    <>
      Share the link. People join with a passkey (Face ID, a fingerprint or the phone PIN). No wallet, no forms, nothing to pay. Joining is
      open for a set time; after that the market is watched.
    </>,
  ],
  [
    "3. Everyone is paid when it becomes likely",
    <>
      Three independent checkers read Gemini’s public order book every few seconds. A reading only counts when the market is healthy: a small
      gap between buy and sell prices, enough contracts on both sides and fresh data. The chance must stay above the line on average over a
      full time window, and two of the three checkers must each see this in their own data. A single price spike never pays. These rules are
      fixed when the money is set aside and cannot change afterwards.
    </>,
  ],
  [
    "If it never gets that likely",
    <>
      The funder chooses beforehand: either the money goes back to them when trading closes, or everyone is still paid when the market
      settles if the event happened (otherwise it goes back to the funder).
    </>,
  ],
  [
    "An early payout is final",
    <>
      Markets can be wrong. If the event does not happen after all, nobody pays anything back; the page says “market was wrong”.
    </>,
  ],
  [
    "Edge cases",
    <ul key="edge" className="list-disc space-y-1 pl-5">
      <li>Bad or missing market data never pays. A data outage that lasts until trading closes counts as “not reached”.</li>
      <li>While Gemini reviews a market, nothing can pay early.</li>
      <li>Market voided before a payout: the funder gets everything back. After a payout: the payout stands.</li>
      <li>If your account cannot receive money, your amount stays reserved for you to collect later.</li>
    </ul>,
  ],
  [
    "Can I check it?",
    <>
      Yes. Every payout page has a proof page with every reading and signature, recomputed in your browser. Payments are public on Arc.
      Builders can read the{" "}
      <Link href="/developers" className="underline underline-offset-4">
        developer docs
      </Link>
      .
    </>,
  ],
  [
    "Is this real money?",
    <>No. This is a test version with test money on Arc testnet. It is not insurance and no hedge is placed.</>,
  ],
];

export default function HowPage() {
  return (
    <article className="mx-auto max-w-[620px] space-y-8">
      <h1 className="t-27 font-semibold">How it works</h1>
      {sections.map(([title, body]) => (
        <section key={title} className="space-y-1.5">
          <h2 className="t-17 font-medium">{title}</h2>
          <div className="t-15" style={{ color: "var(--vg-muted)" }}>
            {body}
          </div>
        </section>
      ))}
      <Link href="/early/new" className="t-15 inline-block rounded-xl px-5 py-3 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
        Try it
      </Link>
    </article>
  );
}
