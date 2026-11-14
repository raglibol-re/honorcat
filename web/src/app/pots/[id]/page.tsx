import { Suspense } from "react";
import { PotView } from "./PotView";

export const metadata = { title: "Pot" };

export default function PotPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading…</p>}>
      <PotView />
    </Suspense>
  );
}
