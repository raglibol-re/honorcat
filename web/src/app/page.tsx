import Link from "next/link";

const steps = [
  { title: "Lock", body: "USDC is deposited into a pot tied to an external condition." },
  { title: "Report", body: "An authorised source signs the outcome once the event is known." },
  { title: "Settle", body: "The contract pays the payees by share, or refunds the funder." },
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">Conditional payouts in USDC</h1>
        <p className="max-w-2xl text-muted">
          Verdict holds USDC in escrow and releases it automatically when an authorised source reports the outcome of
          an external event.
        </p>
        <div className="flex gap-3 pt-2">
          <Link href="/create" className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-surface">
            Create a pot
          </Link>
          <Link href="/ledger" className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium">
            View ledger
          </Link>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <div key={s.title} className="rounded-lg border border-border bg-surface p-5">
            <div className="text-xs font-mono text-muted">0{i + 1}</div>
            <div className="mt-2 font-medium">{s.title}</div>
            <p className="mt-1 text-sm text-muted">{s.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
