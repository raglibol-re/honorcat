import Link from "next/link";
import { LiveExample } from "./LiveExample";

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="grid items-start gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-5 lg:pt-6">
          <h1 className="t-36 max-w-xl font-semibold" style={{ textWrap: "balance" }}>
            Promises that always land.
          </h1>
          <p className="t-17 max-w-xl" style={{ color: "var(--vg-muted)" }}>
            Promise your customers a refund if the world turns against them: &ldquo;If it&apos;s hotter than 95°F on your tour day, you get
            your money back.&rdquo; HonorCat prices the promise from live Gemini markets, locks the refunds in USDC on Arc, lets customers join
            without a wallet, and pays them the moment the market settles.
          </p>
          <p className="t-15 max-w-xl" style={{ color: "var(--vg-muted)" }}>
            A cat always lands on its feet, and so does your money.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/guarantees/new" className="t-15 rounded-xl px-5 py-3 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
              Offer a guarantee
            </Link>
            <Link href="/guarantees" className="t-15 rounded-xl border px-5 py-3 font-medium" style={{ borderColor: "var(--vg-rule)" }}>
              See live guarantees
            </Link>
          </div>
        </div>
        <LiveExample />
      </section>

      <section>
        <h2 className="t-21 font-medium">How a guarantee works</h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {[
            ["The merchant locks the refunds", "Pick a live market, set the refund and the number of customers, and sign once. The full amount is locked in USDC on Arc, visible to anyone."],
            ["Customers join in seconds", "They open a link or scan a code and join. No wallet, no fees: HonorCat submits everything."],
            ["The market decides, the money moves", "When Gemini settles the market, a signed result is verified on Arc and every customer is refunded in the same transaction."],
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
          This is a testnet demo of conditional refunds, not insurance. Chances shown are estimates from Gemini market prices. HonorCat shows
          the hedge a merchant could buy but never places orders.
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
