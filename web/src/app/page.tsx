import Link from "next/link";
import { LiveEarly } from "./LiveEarly";

const steps = [
  ["Set money aside", "Pick an event and how likely it must get. Sign once."],
  ["People join", "They open your link and join with Face ID or a fingerprint."],
  ["Everyone gets paid", "When the market says it is likely enough, the money goes out by itself."],
] as const;

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="grid items-start gap-10 lg:grid-cols-[1fr_420px]">
        <div className="space-y-5 lg:pt-6">
          <h1 className="t-36 max-w-xl font-semibold" style={{ textWrap: "balance" }}>
            Get paid before it happens.
          </h1>
          <p className="t-17 max-w-md">When a market says something is very likely, everyone on the list gets the money. Automatically.</p>
          <div className="flex flex-wrap items-center gap-4">
            <Link href="/early/new" className="t-15 rounded-xl px-5 py-3 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
              Try it
            </Link>
            <Link href="/how" className="t-15 underline underline-offset-4" style={{ color: "var(--vg-muted)" }}>
              How it works
            </Link>
          </div>
        </div>
        <LiveEarly />
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="t-21 font-medium">
          How it works
        </h2>
        <ol className="mt-5 grid gap-6 sm:grid-cols-3">
          {steps.map(([title, body], i) => (
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
    </div>
  );
}
