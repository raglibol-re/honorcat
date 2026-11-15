import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { dropDetail, getDb } from "@/server/relay";
import { DropCheck } from "./DropCheck";

export const metadata = { title: "Payout list" };

/** A payee checks, before the event, that they are on the list and for how much. */
export default function DropPage({ params }: PageProps<"/d/[id]">) {
  return (
    <div className="mx-auto max-w-[520px] space-y-6">
      <Suspense fallback={<p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>}>
        <Drop params={params} />
      </Suspense>
    </div>
  );
}

async function Drop({ params }: { params: PageProps<"/d/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const d = await dropDetail(await getDb(), id);
  if (!d || d.status !== "live") notFound();
  return (
    <>
      <div>
        <h1 className="t-27 font-semibold">{d.name}</h1>
        <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
          Everyone on this list is paid automatically if this happens: {d.conditionLabel}. Nothing to file or claim.
        </p>
      </div>
      <DropCheck drop={d} />
    </>
  );
}
