import Link from "next/link";
import { LiveEarly } from "./LiveEarly";

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="grid items-start gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-5 lg:pt-6">
          <h1 className="t-36 max-w-xl font-semibold" style={{ textWrap: "balance" }}>
            Promises that always land. Paid before it happens.
          </h1>
          <p className="t-17 max-w-xl">
            HonorCat sets money aside for a list of people and pays all of them the moment a live Gemini market considers an event very
            likely, before it happens, so they can prepare.
          </p>
          <p className="t-15 max-w-xl" style={{ color: "var(--vg-muted)" }}>
            Afterwards it records publicly whether the market was right. Nobody fills in a form or files a claim. A cat always lands on its
            feet, and so does your money.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/early/new" className="t-15 rounded-xl px-5 py-3 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
              Try the demo
            </Link>
            <Link href="/guarantees" className="t-15 rounded-xl border px-5 py-3 font-medium" style={{ borderColor: "var(--vg-rule)" }}>
              Refund guarantees
            </Link>
          </div>
        </div>
        <LiveEarly />
      </section>

      <section>
        <h2 className="t-21 font-medium">How it works</h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {[
            ["Set money aside", "Pick any live Gemini market and how likely the event must be, say 85%. Sign once; the money is held on Arc, a public payment network where anyone can see it."],
            ["People join in seconds", "They open a link and join with a passkey. No wallet, no fees, nothing to fill in."],
            ["Paid when it becomes likely", "Three independent checks read the market every few seconds. When two of them see the chance hold above the line, everyone is paid at once."],
          ].map(([title, body], i) => (
            <li key={title} className="border-t pt-4" style={{ borderColor: "var(--vg-rule)" }}>
              <span className="mono t-13" style={{ color: "var(--vg-muted)" }}>
                {i + 1}
              </span>
              <h3 className="t-17 mt-1 font-medium">{title}</h3>
              <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
                {body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="t-15 max-w-2xl space-y-2" style={{ color: "var(--vg-muted)" }}>
        <p>
          This is a testnet demo, not insurance. Chances come from Gemini market prices, which can be wrong; an early payout is final. No
          hedge is placed.
        </p>
        <p>
          HonorCat is settled by Verdict. Building on Verdict? The vault, relay API and SDK are documented under{" "}
          <Link href="/developers" className="underline underline-offset-4">
            Developers
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
