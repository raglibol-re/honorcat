import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getDb } from "@/server/relay";
import { EarlyView } from "./EarlyView";

export const metadata = { title: "Paid before it happens" };

const loading = <p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>;

export default function EarlyPage({ params }: PageProps<"/e/[id]">) {
  return (
    <div>
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
  return <EarlyView />;
}
