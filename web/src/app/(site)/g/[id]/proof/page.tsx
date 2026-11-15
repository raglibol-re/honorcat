import { Suspense } from "react";
import { requireGuarantee } from "@/server/exists";
import { ProofView } from "./ProofView";

export const metadata = { title: "Public proof" };

const loading = <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;

export default function ProofPage({ params }: PageProps<"/g/[id]/proof">) {
  return (
    <Suspense fallback={loading}>
      <Checked params={params} />
    </Suspense>
  );
}

async function Checked({ params }: { params: Promise<{ id: string }> }) {
  await requireGuarantee(params);
  return <ProofView />;
}
