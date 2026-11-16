"use client";

import { Cat, type CatPose } from "@/components/cat/Cat";
import { Paw } from "@/components/cat/shapes";
import { C, F } from "@/components/cat/tokens";
import { RollingNumber } from "@/components/cat/RollingNumber";

export type RopePhase = "waiting" | "joining" | "live" | "exit" | "divided" | "settled" | "expired";
export type SideLevels = { net: number; bowl: number } | null | undefined; // ppm of the side's own price, 0 = unset

export type RopeProps = {
  /** Smoothed YES price, 0..1 (null while loading). */
  price: number | null;
  /** Pot size in USDC base units. */
  notional: bigint;
  names: { yes: string; no: string };
  phase: RopePhase;
  levels?: { yes?: SideLevels; no?: SideLevels };
  /** Exit or join window (unix seconds) and the clock. */
  window?: { label: string; start: number; end: number; now: number } | null;
  /** The exit-price stamp after a division. */
  stamp?: string | null;
  /** Settlement: the cat walks to the side that received the pot (0 YES, 1 NO, 2 both refunded). */
  winner?: 0 | 1 | 2 | null;
  trail?: { mid: number }[];
  speed?: number;
  big?: boolean;
};

const L = 5; // rope starts at 5% and ends at 95%
const W = 90;
const xOf = (p: number) => L + W * Math.min(1, Math.max(0, p));

function poseFor(p: RopeProps): CatPose {
  if (p.phase === "waiting") return "sleep";
  if (p.phase === "expired") return "box";
  if (p.phase === "settled") return p.winner === 2 ? "box" : "land";
  if (p.phase === "divided") return "land";
  if ((p.phase === "exit" || p.phase === "joining") && p.window) return p.window.now < p.window.start ? "crouch" : p.phase === "exit" ? "air" : "rope";
  if (p.price === null) return "peek";
  return (p.speed ?? 0) > 1.5 ? "wobble" : "rope";
}

const money = (base: bigint) => Number(base) / 1e6;

/** Dollars that roll like an odometer; cents as plain digits. */
function Dollars({ v }: { v: number }) {
  const cents = Math.round(v * 100);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline" }}>
      $<RollingNumber value={Math.floor(cents / 100)} />.{String(cents % 100).padStart(2, "0")}
    </span>
  );
}

/** A ring that empties as the window runs out, with the seconds left inside. */
function Countdown({ start, end, now, size }: { start: number; end: number; now: number; size: number }) {
  const total = Math.max(1, end - start);
  const left = Math.max(0, Math.min(total, end - now));
  const waiting = now < start;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ position: "absolute", inset: 0, margin: "auto" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.faint} strokeWidth={3} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={C.signal}
        strokeWidth={3}
        strokeDasharray={c}
        strokeDashoffset={waiting ? 0 : c * (1 - left / total)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset 900ms linear" }}
      />
    </svg>
  );
}

/** Net (a little hammock under the rope) or bowl (on the rope) at a price position. */
function Marker({ x, kind, side, big }: { x: number; kind: "net" | "bowl"; side: 0 | 1; big?: boolean }) {
  const s = big ? 1.6 : 1;
  const label = `${side === 0 ? "YES" : "NO"} ${kind}`;
  return (
    <div style={{ position: "absolute", left: `${x}%`, top: kind === "net" ? "calc(50% + 6px)" : "calc(50% - 46px)", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, pointerEvents: "none" }}>
      {kind === "net" ? (
        <svg width={44 * s} height={18 * s} viewBox="0 0 44 18" aria-hidden="true">
          <path d="M2 2 Q22 22 42 2" fill="none" stroke={side === 0 ? C.ink : C.signal} strokeWidth="1.6" />
          <path d="M8 5 L14 13 M16 8 L20 15 M24 15 L28 8 M30 13 L36 5 M10 9 L34 9" fill="none" stroke={side === 0 ? C.ink : C.signal} strokeWidth="0.9" />
        </svg>
      ) : (
        <svg width={30 * s} height={16 * s} viewBox="0 0 30 16" aria-hidden="true">
          <path d="M2 4 L28 4 L24 14 L6 14 Z" fill={side === 0 ? C.ink : C.signal} />
          <ellipse cx="15" cy="4" rx="13" ry="2.4" fill={C.page} stroke={side === 0 ? C.ink : C.signal} strokeWidth="1.2" />
        </svg>
      )}
      <span style={{ fontSize: big ? 18 : 12, color: C.muted, whiteSpace: "nowrap", order: kind === "net" ? 1 : -1 }}>{label}</span>
    </div>
  );
}

/**
 * The rope view: two posts (YES left, NO right), the pot hanging between them as a rope, the cat
 * standing at the smoothed price. The rope left of the cat is YES's share (ink), right of it NO's
 * (signal); both in dollars over the posts. Nets and bowls sit at their prices; an exit shows a
 * countdown ring and, once divided, the exit-price stamp; at settlement the cat walks to the side
 * that receives the pot.
 */
export function Rope(p: RopeProps) {
  const price = p.price;
  const n = money(p.notional);
  const yes = price === null ? null : n * price;
  const no = price === null ? null : n - n * price;
  const pose = poseFor(p);
  const catX = p.phase === "settled" && (p.winner === 0 || p.winner === 1) ? (p.winner === 0 ? L : L + W) : p.phase === "waiting" || price === null ? 50 : xOf(price);
  const catSize = p.big ? 220 : 120;
  const height = p.big ? "52vh" : 280;
  const fs = p.big ? 96 : 52;
  const nameFs = p.big ? 30 : 18;
  const split = price === null ? 50 : xOf(price);
  const rope = p.big ? 8 : 5;
  const post = p.big ? 8 : 6;

  const levels: { x: number; kind: "net" | "bowl"; side: 0 | 1 }[] = [];
  const lv = p.levels ?? {};
  if (lv.yes?.net) levels.push({ x: xOf(lv.yes.net / 1e6), kind: "net", side: 0 });
  if (lv.yes?.bowl) levels.push({ x: xOf(lv.yes.bowl / 1e6), kind: "bowl", side: 0 });
  if (lv.no?.net) levels.push({ x: xOf(1 - lv.no.net / 1e6), kind: "net", side: 1 });
  if (lv.no?.bowl) levels.push({ x: xOf(1 - lv.no.bowl / 1e6), kind: "bowl", side: 1 });

  const alt =
    price === null
      ? "Waiting for the price."
      : `YES ${p.names.yes}: $${yes!.toFixed(2)} (${(price * 100).toFixed(1)}%). NO ${p.names.no}: $${no!.toFixed(2)}. Smoothed over 30 seconds.`;

  return (
    <figure role="group" aria-label={alt} style={{ margin: 0, display: "flex", flexDirection: "column", gap: p.big ? 24 : 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: nameFs, color: C.muted }}>
            <strong style={{ color: C.ink, fontWeight: 600 }}>YES</strong> {p.names.yes}
          </span>
          <span style={{ fontFamily: F.cond, fontSize: fs, fontWeight: 600, lineHeight: 0.9 }}>
            {yes === null ? "–" : <Dollars v={yes} />}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", textAlign: "right" }}>
          <span style={{ fontSize: nameFs, color: C.muted }}>
            {p.names.no} <strong style={{ color: C.signalInk, fontWeight: 600 }}>NO</strong>
          </span>
          <span style={{ fontFamily: F.cond, fontSize: fs, fontWeight: 600, lineHeight: 0.9, color: C.signalInk }}>
            {no === null ? "–" : <Dollars v={no} />}
          </span>
        </div>
      </div>

      <div style={{ position: "relative", height, minHeight: 220 }}>
        {/* posts, ground and the rope in two colours (HTML so the split can glide) */}
        <div aria-hidden="true" style={{ position: "absolute", left: `${L}%`, top: "50%", bottom: 0, width: post, marginLeft: -post / 2, background: C.ink }} />
        <div aria-hidden="true" style={{ position: "absolute", left: `${L + W}%`, top: "50%", bottom: 0, width: post, marginLeft: -post / 2, background: C.signal }} />
        <div aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 1.5, background: C.ink }} />
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: `${L}%`, width: `${split - L}%`, top: "50%", height: rope, marginTop: -rope / 2, background: C.ink, transition: "width 1200ms ease" }}
        />
        <div
          aria-hidden="true"
          style={{ position: "absolute", left: `${split}%`, right: `${100 - L - W}%`, top: "50%", height: rope, marginTop: -rope / 2, background: C.signal, transition: "left 1200ms ease" }}
        />

        {/* the paw path: where the smoothed price has been in the last minutes */}
        {(p.trail ?? []).slice(-24).map((t, i, a) => (
          <svg
            key={i}
            width={p.big ? 16 : 10}
            height={p.big ? 16 : 10}
            viewBox="-6 -6 12 12"
            aria-hidden="true"
            style={{ position: "absolute", left: `${xOf(t.mid)}%`, top: `calc(50% + ${p.big ? 14 : 9}px)`, transform: "translateX(-50%)", opacity: 0.15 + (0.55 * (i + 1)) / a.length }}
          >
            <Paw x={0} y={0} rotate={90} scale={0.35} fill={C.dash} />
          </svg>
        ))}

        {levels.map((m, i) => (
          <Marker key={i} {...m} big={p.big} />
        ))}

        {/* the cat */}
        <div
          style={{
            position: "absolute",
            left: `${catX}%`,
            bottom: "50%",
            transform: "translate(-50%, 8%)",
            transition: p.phase === "settled" ? "left 2600ms ease-in-out" : "left 1200ms ease",
            width: catSize,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ position: "relative" }}>
            {p.window && (p.phase === "exit" || p.phase === "joining") && <Countdown start={p.window.start} end={p.window.end} now={p.window.now} size={catSize * 1.15} />}
            <Cat pose={pose} size={catSize} />
          </div>
        </div>

        {p.window && (p.phase === "exit" || p.phase === "joining") && (
          <p
            aria-live="polite"
            style={{ position: "absolute", left: 0, right: 0, top: 0, margin: 0, textAlign: "center", fontSize: p.big ? 24 : 15, color: C.body }}
          >
            {p.window.now < p.window.start
              ? `${p.window.label}: measuring starts in a moment`
              : p.window.now < p.window.end
                ? `${p.window.label}: ${p.window.end - p.window.now} s of measuring left`
                : `${p.window.label}: the samplers are agreeing on the price`}
          </p>
        )}

        {p.stamp && (
          <div
            style={{
              position: "absolute",
              right: "12%",
              top: "8%",
              transform: "rotate(-8deg)",
              border: `3px solid ${C.signal}`,
              color: C.signalInk,
              padding: p.big ? "10px 22px" : "6px 14px",
              fontFamily: F.cond,
              fontWeight: 700,
              fontSize: p.big ? 40 : 24,
              letterSpacing: "0.02em",
              background: C.page,
            }}
          >
            {p.stamp}
          </div>
        )}
      </div>

      <figcaption style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: p.big ? 20 : 14, color: C.muted }}>
        <span>
          Pot ${n.toFixed(2)}. {price === null ? "Reading the price." : `The cat stands at ${(price * 100).toFixed(1)}% YES, averaged over 30 seconds.`}
        </span>
        <span>Data provided by Gemini.</span>
      </figcaption>
    </figure>
  );
}
