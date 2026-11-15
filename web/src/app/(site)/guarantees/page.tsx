import Link from "next/link";
import { GuaranteeList } from "./GuaranteeList";

export const metadata = { title: "Guarantees" };

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
        <Link href="/guarantees/new" className="t-15 px-4 py-2.5 font-medium" style={{ background: "#111111", color: "#ECEAE4" }}>
          New guarantee
        </Link>
      </div>
      <GuaranteeList />
    </div>
  );
}
