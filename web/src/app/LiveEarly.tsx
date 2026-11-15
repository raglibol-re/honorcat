"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProbabilityChart } from "@/components/early/ProbabilityChart";
import { getJson } from "@/lib/api";
import { formatDate, formatMoney } from "@/lib/format";
import { headline, type EarlyDetail } from "./e/[id]/EarlyView";
import { LiveExample } from "./LiveExample";

type Row = EarlyDetail["early"];

const STATE: Record<string, string> = {
  locked: "Open to join",
  armed: "Watching the market",
};

const card = "vg-ticket block w-full max-w-[420px] space-y-3 px-5 py-5";
const muted = { color: "var(--vg-muted)" };

/**
 * The landing example: an open or watched early payout, live; when there is none, a labelled
 * replay of the latest real early payout (its recorded samples played back); else a guarantee.
 */
export function LiveEarly() {
  const [mode, setMode] = useState<"loading" | "live" | "replay" | "fallback" | "error">("loading");
  const [live, setLive] = useState<{ row: Row; d: EarlyDetail | null } | null>(null);
  const [replay, setReplay] = useState<EarlyDetail | null>(null);

  useEffect(() => {
    let stop = false;
    let id: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      try {
        if (!id) {
          const { early } = await getJson<{ early: Row[] }>("/api/early");
          const pick = early.find((e) => e.state === "locked" || e.state === "armed");
          if (!pick) {
            const r = await getJson<EarlyDetail>("/api/early/replay").catch(() => null);
            if (stop) return;
            if (r) {
              setReplay(r);
              setMode("replay");
            } else setMode("fallback");
            return;
          }
          id = pick.id;
          if (!stop) {
            setLive({ row: pick, d: null });
            setMode("live");
          }
        }
        const detail = await getJson<EarlyDetail>(`/api/early/${id}`);
        if (!stop) setLive({ row: detail.early, d: detail });
      } catch {
        if (!stop && !id) setMode("error");
      }
      if (!stop) timer = setTimeout(run, 5000);
    };
    void run();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);

  if (mode === "fallback") return <LiveExample />;
  if (mode === "error")
    return (
      <p className={`${card} t-15`} style={muted}>
        Could not load the example. Reload to try again.
      </p>
    );
  if (mode === "replay" && replay) return <Replay d={replay} />;
  if (mode === "live" && live) {
    const { row: e, d } = live;
    const latest = d ? ([...d.samples].reverse().find((s) => s.status === 0 && s.mid !== null)?.mid ?? d.market?.chance ?? null) : null;
    return (
      <Link href={`/e/${e.id}`} className={card}>
        <p className="t-13" style={muted}>
          Live now: {STATE[e.state] ?? e.state}
        </p>
        <Head e={e} />
        <Numbers amount={e.amount} chance={latest} threshold={e.params.thresholdBps / 10_000} />
        {d ? (
          <ProbabilityChart samples={d.samples} threshold={e.params.thresholdBps / 10_000} windowMs={e.params.windowMs} armedAt={e.lockTime * 1000} height={200} />
        ) : (
          <div className="h-[170px] animate-pulse rounded-lg" style={{ background: "var(--vg-rule)", opacity: 0.3 }} aria-hidden />
        )}
      </Link>
    );
  }
  return <div className={`${card} h-[440px] animate-pulse`} aria-hidden />;
}

function Head({ e }: { e: Row }) {
  return (
    <div>
      <p className="t-17 font-semibold leading-snug">{headline(e)}</p>
      <p className="t-13" style={muted}>
        {e.eventTitle}
      </p>
    </div>
  );
}

function Numbers({ amount, chance, threshold }: { amount: string; chance: number | null; threshold: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="mono t-27 font-medium">{formatMoney(amount)}</span>
      <span className="t-15">
        <span className="mono">{chance === null ? "—" : `${Math.round(chance * 100)}%`}</span> now, pays at <span className="mono">{Math.round(threshold * 100)}%</span>
      </span>
    </div>
  );
}

const PLAY_MS = 14_000;
const HOLD_MS = 4_000;

/** Plays back a real early payout's recorded samples, clearly labelled as a replay. */
function Replay({ d }: { d: EarlyDetail }) {
  const e = d.early;
  const threshold = e.params.thresholdBps / 10_000;
  const samples = [...d.samples].sort((a, b) => a.t - b.t);
  const triggerAt =
    d.signatures
      .filter((s) => s.kind === "trigger")
      .map((s) => Number((s.record as { windowEnd?: string } | null)?.windowEnd ?? 0))
      .sort((a, b) => a - b)[1] ?? (d.settledAt ? new Date(d.settledAt).getTime() : null);
  const tStart = samples[0]?.t ?? 0;
  const tEnd = Math.max(triggerAt ?? samples.at(-1)?.t ?? tStart + 1, samples.at(-1)?.t ?? 0, tStart + 1);
  const mids = samples.filter((s) => s.status === 0 && s.mid !== null).map((s) => s.mid!);
  const range: [number, number] = [Math.max(0, Math.min(threshold - 0.1, ...mids) - 0.02), Math.min(1, Math.max(threshold + 0.05, ...mids) + 0.02)];

  const [p, setP] = useState(1); // progress 0..1; starts complete (reduced motion, first paint)
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const started = performance.now();
    const t = setInterval(() => {
      const k = (performance.now() - started) % (PLAY_MS + HOLD_MS);
      setP(Math.min(1, 0.08 + (0.92 * k) / PLAY_MS));
    }, 120);
    return () => clearInterval(t);
  }, []);

  const cursor = tStart + p * (tEnd - tStart);
  const shown = samples.filter((s) => s.t <= cursor);
  const chance = [...shown].reverse().find((s) => s.status === 0 && s.mid !== null)?.mid ?? null;
  const paid = triggerAt !== null && cursor >= triggerAt;
  return (
    <Link href={`/e/${e.id}`} className={card}>
      <p className="t-13 flex justify-between gap-2" style={muted}>
        <span>Replay of a real payout</span>
        <span>{d.settledAt ? formatDate(new Date(d.settledAt).getTime()) : ""}</span>
      </p>
      <Head e={e} />
      <Numbers amount={e.amount} chance={chance} threshold={threshold} />
      <ProbabilityChart
        samples={shown}
        threshold={threshold}
        windowMs={e.params.windowMs}
        armedAt={e.lockTime * 1000}
        triggeredAt={paid ? triggerAt : null}
        domain={[tStart, tEnd]}
        range={range}
        height={200}
      />
      <p className="t-15 font-medium" style={{ color: paid ? "var(--vg-accent)" : "var(--vg-muted)" }}>
        {paid ? "Paid early to everyone on the list" : "Watching the market…"}
      </p>
    </Link>
  );
}
