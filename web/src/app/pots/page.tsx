import Link from "next/link";
import { PotList } from "./PotList";

export const metadata = { title: "Pots · Verdict" };

export default function PotsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pots</h1>
          <p className="text-sm text-muted">The vault pots behind each listed guarantee.</p>
        </div>
        <Link href="/guarantees/new" className="text-sm text-accent hover:underline">
          New guarantee
        </Link>
      </div>
      <PotList />
    </div>
  );
}
