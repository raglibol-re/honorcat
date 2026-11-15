"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProbabilityChart } from "@/components/early/ProbabilityChart";
import { getJson } from "@/lib/api";
import { formatMoney } from "@/lib/format";
import type { EarlyDetail } from "./e/[id]/EarlyView";
import { LiveExample } from "./LiveExample";

type Row = EarlyDetail["early"];

const STATE: Record<string, string> = {
  locked: "Open to join",
  armed: "Watching the market",
  paid: "Paid",
  refunded: "No payout",
  closed: "Market closed",
};

/** One real early payout from this deployment, live; falls back to a live guarantee. */
export function LiveEarly() {
  const [d, setD] = useState<EarlyDetail | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [none, setNone] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let stop = false;
    let id: string | null = null;
    const run = async () => {
      try {
        if (!id) {
          const { early } = await getJson<{ early: Row[] }>("/api/early");
          const pick = early.find((e) => e.state === "locked" || e.state === "armed") ?? early.find((e) => e.state === "paid") ?? early[0];
          if (!pick) {
            setNone(true);
            return;
          }
          id = pick.id;
          if (!stop) setRow(pick); // render the card at once; the chart follows
        }
        const detail = await getJson<EarlyDetail>(`/api/early/${id}`);
        if (!stop) {
          setD(detail);
          setFailed(false);
        }
      } catch {
        if (!stop) setFailed(true); // keep the last good state; retry below
      }
      if (!stop) setTimeout(run, 5000);
    };
    void run();
    return () => {
      stop = true;
    };
  }, []);

  if (none) return <LiveExample />;
  const e = d?.early ?? row;
  if (!e && failed) {
    return (
      <p className="vg-ticket t-15 w-full max-w-[420px] px-5 py-5" style={{ color: "var(--vg-muted)" }}>
        The live example cannot be loaded right now. Retrying…
      </p>
    );
  }
  if (!e) return <div className="vg-ticket h-[420px] w-full max-w-[420px] animate-pulse" aria-hidden />;
  const latest = d ? ([...d.samples].reverse().find((s) => s.status === 0 && s.mid !== null)?.mid ?? d.market?.chance ?? null) : null;
  return (
    <div className="space-y-2">
      <Link href={`/e/${e.id}`} className="vg-ticket block w-full max-w-[420px] space-y-3 px-5 py-5">
        <p className="t-13" style={{ color: "var(--vg-muted)" }}>
          Live example · {STATE[e.state] ?? e.state}
        </p>
        <p className="t-17 font-semibold leading-snug">{e.promise}</p>
        <div className="flex items-baseline justify-between">
          <span className="mono t-27 font-medium">{formatMoney(e.amount)}</span>
          <span className="t-15">
            chance now <span className="mono">{latest === null ? "—" : `${Math.round(latest * 100)}%`}</span>, pays at{" "}
            <span className="mono">{e.params.thresholdBps / 100}%</span>
          </span>
        </div>
        {d ? (
          <ProbabilityChart samples={d.samples} threshold={e.params.thresholdBps / 10_000} windowMs={e.params.windowMs} armedAt={e.lockTime * 1000} height={120} />
        ) : (
          <div className="h-[120px] animate-pulse rounded-lg" style={{ background: "var(--vg-rule)", opacity: 0.3 }} aria-hidden />
        )}
      </Link>
      <p className="t-13" style={{ color: "var(--vg-muted)" }}>
        A real early payout on this deployment.{" "}
        <Link href={`/e/${e.id}/proof`} className="underline underline-offset-4">
          See its proof
        </Link>
      </p>
    </div>
  );
}
