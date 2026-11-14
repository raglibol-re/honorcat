import Link from "next/link";
import { PotList } from "./PotList";

export const metadata = { title: "Pots · Verdict" };

export default function PotsPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pots</h1>
          <p className="text-sm text-muted">All pots registered in the vault.</p>
        </div>
        <Link href="/create" className="text-sm text-accent hover:underline">
          Create pot
        </Link>
      </div>
      <PotList />
    </div>
  );
}
