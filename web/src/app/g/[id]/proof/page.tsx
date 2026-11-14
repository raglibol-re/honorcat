import { Suspense } from "react";
import { ProofView } from "./ProofView";

export const metadata = { title: "Public proof" };

export default function ProofPage() {
  return (
    <Suspense fallback={<p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>}>
      <ProofView />
    </Suspense>
  );
}
