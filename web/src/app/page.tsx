import Link from "next/link";
import { LiveEarly } from "./LiveEarly";

export default function Home() {
  return (
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
  );
}
