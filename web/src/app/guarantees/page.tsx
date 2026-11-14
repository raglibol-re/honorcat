import Link from "next/link";
import { GuaranteeList } from "./GuaranteeList";

export const metadata = { title: "Guarantees · Verdict" };

export default function GuaranteesPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-27 font-semibold">Guarantees</h1>
          <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
            Every refund promise on this deployment, with the money locked for it on Arc.
          </p>
        </div>
        <Link href="/guarantees/new" className="t-15 rounded-xl px-4 py-2.5 font-medium" style={{ background: "var(--vg-accent)", color: "var(--vg-card)" }}>
          New guarantee
        </Link>
      </div>
      <GuaranteeList />
    </div>
  );
}
