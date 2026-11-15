import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/relay";
import { EarlyProof } from "./EarlyProof";

export const metadata = { title: "Public proof" };

const loading = <p className="t-15" style={{ color: "var(--hc-muted)" }}>Loading…</p>;

export default function EarlyProofPage({ params }: PageProps<"/e/[id]/proof">) {
  return (
    <div className="mx-auto max-w-[760px]">
      <Suspense fallback={loading}>
        <Checked params={params} />
      </Suspense>
    </div>
  );
}

async function Checked({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const rows = await (await getDb()).query("SELECT 1 FROM early_pots WHERE id = $1 AND status = 'live'", [id]);
  if (!rows.length) notFound();
  return <EarlyProof />;
}
