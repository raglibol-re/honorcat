"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { GuaranteeCard } from "@/components/guarantee/GuaranteeCard";
import { getJson } from "@/lib/api";
import { toCard, type GuaranteeDetail } from "@/lib/guarantees";

type Row = { id: string; potStatus: string | null; status: string; template: string };

/** One real guarantee from this deployment, live: an open one if there is one, else the latest. */
export function LiveExample() {
  const [d, setD] = useState<GuaranteeDetail | null>(null);
  const [none, setNone] = useState(false);
  useEffect(() => {
    let stop = false;
    let id: string | null = null;
    const run = async () => {
      try {
        if (!id) {
          const { guarantees } = await getJson<{ guarantees: Row[] }>("/api/guarantees");
          const pick = guarantees.find((g) => g.potStatus === "open") ?? guarantees[0];
          if (!pick) {
            setNone(true);
            return;
          }
          id = pick.id;
        }
        const detail = await getJson<GuaranteeDetail>(`/api/guarantees/${id}`);
        if (!stop) setD(detail);
      } catch {
        /* keep the last good state */
      }
      if (!stop) setTimeout(run, 5000);
    };
    run();
    return () => {
      stop = true;
    };
  }, []);

  if (none) return null;
  if (!d) return <div className="vg-ticket h-[460px] w-full max-w-[420px] animate-pulse" aria-hidden />;
  return (
    <div className="space-y-2">
      <GuaranteeCard g={toCard(d, null)} />
      <p className="t-13" style={{ color: "var(--vg-muted)" }}>
        A live guarantee on this deployment.{" "}
        <Link href={`/g/${d.guarantee.id}/proof`} className="underline underline-offset-4">
          See its proof
        </Link>
      </p>
    </div>
  );
}
