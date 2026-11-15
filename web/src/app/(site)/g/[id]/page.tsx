import { Suspense } from "react";
import { requireGuarantee } from "@/server/exists";
import { CustomerView } from "./CustomerView";

export const metadata = { title: "Your guarantee" };

const loading = <p className="t-15" style={{ color: "var(--hc-muted)" }}>Loading…</p>;

export default function GuaranteePage({ params }: PageProps<"/g/[id]">) {
  return (
    <Suspense fallback={loading}>
      <Checked params={params} />
    </Suspense>
  );
}

async function Checked({ params }: { params: Promise<{ id: string }> }) {
  await requireGuarantee(params);
  return <CustomerView />;
}
