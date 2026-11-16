"use client";

import { useEffect, useRef, useState } from "react";
import { Cat, type CatPose, type Mood } from "@/components/cat/Cat";
import { FURS, type Fur } from "@/lib/names";
import { splitPot } from "@/lib/shares";
import { RollingNumber } from "@/components/cat/RollingNumber";
import { C, F } from "@/components/cat/tokens";

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
  /** Settlement: the cat walks to the side that receives the pot (0 YES, 1 NO, 2 both refunded). */
  receiver?: 0 | 1 | 2 | null;
  trail?: { mid: number }[];
  speed?: number;
  big?: boolean;
  /** The pot's size at creation, when it differs (after partial exits). */
  startedAt?: bigint | null;
  /** The market as a statement and its opposite: what each side stands for (YES, NO only in technical details). */
  sides?: { yes: string; no: string; yesShort: string; noShort: string };
  /** Each player's cat at its post (null: an open seat), with how it feels about its side. */
  cats?: { yes: PostCat | null; no: PostCat | null };
};
export type PostCat = { fur: Fur; mood: Mood; name: string };

/* The drawing, in the approved mockup's units: 1440 wide, the 0..100 scale from x 40 to x 1400. */
const VW = 1440;
const VH = 330;
const X0 = 40;
const SPAN = 1360;
const GROUND = 250; // the ruler's baseline
const TOP = 118; // where the rope leaves the posts
const SAG = 26;
const xOf = (p: number) => X0 + SPAN * Math.min(1, Math.max(0, p));
const yOf = (p: number) => TOP + SAG * 4 * Math.min(1, Math.max(0, p)) * (1 - Math.min(1, Math.max(0, p)));
const pctX = (p: number) => (xOf(p) / VW) * 100;
const pctY = (p: number) => (yOf(p) / VH) * 100;

function poseFor(p: RopeProps): CatPose {
  if (p.phase === "waiting") return "sleep";
  if (p.phase === "expired") return "box";
  if (p.phase === "settled") return p.receiver === 2 ? "box" : "land";
  if (p.phase === "divided") return "land";
  if ((p.phase === "exit" || p.phase === "joining") && p.window) return p.window.now < p.window.start ? "crouch" : p.phase === "exit" ? "air" : "rope";
  if (p.price === null) return "peek";
  return (p.speed ?? 0) > 1.5 ? "wobble" : "rope";
}

const money = (base: bigint) => Number(base) / 1e6;

/** Dollars that roll like an odometer; screen readers get the plain amount. */
function Dollars({ v }: { v: number }) {
  const cents = Math.round(v * 100);
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", fontVariantNumeric: "tabular-nums" }}>
      <span className="hc-sr">{`$${(cents / 100).toFixed(2)}`}</span>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "baseline" }}>
        $<RollingNumber value={Math.floor(cents / 100)} />.{String(cents % 100).padStart(2, "0")}
      </span>
    </span>
  );
}

function ropePath(from: number, to: number) {
  const pts: string[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const p = from + ((to - from) * i) / n;
    pts.push(`${xOf(p).toFixed(1)},${yOf(p).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/** The approved mockup's ruler: minor tick every point, medium every 5, labelled major every 10. */
function Ruler({ question }: { question?: string }) {
  const ticks = [];
  for (let i = 0; i <= 100; i++) {
    const x = X0 + (SPAN * i) / 100;
    const major = i % 10 === 0;
    const mid = !major && i % 5 === 0;
    ticks.push(<line key={i} x1={x} y1={GROUND - (major ? 34 : mid ? 24 : 14)} x2={x} y2={GROUND} stroke={C.ink} strokeWidth={major ? 2 : mid ? 1.5 : 1} />);
    if (major)
      ticks.push(
        <text key={`t${i}`} x={x} y={GROUND + 30} textAnchor="middle" fontFamily="var(--font-barlow-condensed), 'Arial Narrow', sans-serif" fontSize="22" fontWeight="500" fill={C.ink}>
          {i}
        </text>,
      );
  }
  return (
    <g aria-hidden="true">
      <line x1={X0} y1={GROUND} x2={X0 + SPAN} y2={GROUND} stroke={C.ink} strokeWidth="2" />
      {ticks}
      <text x={X0 + SPAN} y={GROUND + 58} textAnchor="end" fontFamily="var(--font-barlow), Arial, sans-serif" fontSize="17" fill={C.muted}>
        {question ? `% chance that ${question.length > 70 ? `${question.slice(0, 68)}…` : question}` : "% chance"}
      </text>
    </g>
  );
}

function PawMark({ x, y, dir, opacity }: { x: number; y: number; dir: 1 | -1; opacity: number }) {
  return (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${dir * 90}) scale(0.95)`} fill={C.dash} opacity={opacity}>
      <ellipse cx="0" cy="3" rx="6" ry="5" />
      <circle cx="-6.2" cy="-4" r="2.4" />
      <circle cx="-2.2" cy="-7.6" r="2.4" />
      <circle cx="2.4" cy="-7.6" r="2.4" />
      <circle cx="6.4" cy="-4" r="2.4" />
    </g>
  );
}

/** A side's net (a hammock under the rope) or bowl (on the ground), with the zone where it acts. */
function Level({ side, kind, own, who }: { side: 0 | 1; kind: "net" | "bowl"; own: number; who: string }) {
  // The YES price at which this side's own price reaches the level.
  const p = side === 0 ? own : 1 - own;
  const x = xOf(p);
  const y = yOf(p);
  const zone = kind === "net" ? (side === 0 ? [0, p] : [p, 1]) : side === 0 ? [p, 1] : [0, p];
  const color = side === 0 ? C.ink : C.signal;
  const label = `${/^you( |$)/.test(who) ? "your" : `${who}'s`} ${kind} at ${(own * 100).toFixed(0)}%`;
  return (
    <g>
      <rect x={xOf(zone[0]!)} y={TOP + 40} width={Math.max(0, xOf(zone[1]!) - xOf(zone[0]!))} height={GROUND - TOP - 40} fill={kind === "bowl" ? C.signal : C.ink} opacity={kind === "bowl" ? 0.12 : 0.06} />
      {kind === "net" ? (
        <g stroke={color} fill="none">
          <path d={`M${x - 46} ${y + 6} Q${x} ${y + 64} ${x + 46} ${y + 6}`} strokeWidth="2.5" />
          <path d={`M${x - 30} ${y + 18} L${x - 18} ${y + 40} M${x - 10} ${y + 26} L${x - 2} ${y + 44} M${x + 10} ${y + 26} L${x + 2} ${y + 44} M${x + 30} ${y + 18} L${x + 18} ${y + 40} M${x - 36} ${y + 24} L${x + 36} ${y + 24}`} strokeWidth="1.2" />
        </g>
      ) : (
        <g>
          <path d={`M${x - 30} ${GROUND} L${x + 30} ${GROUND} L${x + 22} ${GROUND - 24} L${x - 22} ${GROUND - 24} Z`} fill={C.signal} />
          <path d={`M${x - 18} ${GROUND - 24} Q${x} ${GROUND - 42} ${x + 18} ${GROUND - 24} Z`} fill={C.ink} />
        </g>
      )}
      <text
        x={Math.min(Math.max(x, X0 + 90), X0 + SPAN - 90)}
        y={kind === "net" ? y + 86 : GROUND - 52}
        textAnchor="middle"
        fontFamily="var(--font-barlow), Arial, sans-serif"
        fontSize="19"
        fontWeight="600"
        fill={side === 0 ? C.ink : C.signalInk}
      >
        {label}
      </text>
    </g>
  );
}

/** A ring that empties as the window runs out. */
function Countdown({ start, end, now }: { start: number; end: number; now: number }) {
  const total = Math.max(1, end - start);
  const left = Math.max(0, Math.min(total, end - now));
  const waiting = now < start;
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" style={{ position: "absolute", left: "-14%", top: "-14%", width: "128%", height: "128%" }}>
      <circle cx="50" cy="50" r={r} fill="none" stroke={C.faint} strokeWidth="3" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={C.signal}
        strokeWidth="3"
        strokeDasharray={c}
        strokeDashoffset={waiting ? 0 : c * (1 - left / total)}
        transform="rotate(-90 50 50)"
        style={{ transition: "stroke-dashoffset 900ms linear" }}
      />
    </svg>
  );
}

/** A player's cat sitting on top of its post, facing the rope. */
function PostCatView({ c, side, w }: { c: PostCat; side: 0 | 1; w: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: `${pctX(side)}%`,
        top: `${((TOP - 20) / VH) * 100}%`,
        width: w,
        // Keep the cats inside the stage (no sideways scrolling on phones) and facing the rope.
        transform: `translate(${side === 0 ? "-30%" : "-70%"}, -92%) scaleX(${side === 0 ? 1 : -1})`,
      }}
    >
      <Cat pose="sit" size={w} fur={FURS[c.fur]} mood={c.mood} label={`${c.name}'s cat, on the ${side === 0 ? "YES" : "NO"} post`} />
    </div>
  );
}

/**
 * The rope view: the pot hangs as a rope between two posts over the 0 to 100 scale of the YES
 * chance (the approved mockup's ruler). The cat stands at the 30-second price; left of it is YES's
 * share, right of it NO's, each in its player's fur colour, both in dollars over the posts. Each
 * player's cat sits on its post and perks up or droops with its side. Paw prints show where the
 * price has been; nets and bowls sit at their levels; an exit shows a countdown ring and the
 * exit-price stamp; at settlement the cat walks to the post of the side that receives the pot.
 */
export function Rope(p: RopeProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const price = p.price;
  const n = money(p.notional);
  // One side rounded to the cent, the other the pot minus it: the two always add up to the pot.
  const shares = price === null ? null : splitPot(p.notional, price);
  const yes = shares === null ? null : Number(shares.yes) / 1e6;
  const no = shares === null ? null : Number(shares.no) / 1e6;
  const pose = poseFor(p);
  const catP = p.phase === "settled" && (p.receiver === 0 || p.receiver === 1) ? (p.receiver === 0 ? 0 : 1) : (price ?? 0.5);
  const catW = Math.max(56, Math.min(p.big ? 260 : 150, width * 0.1));
  const split = price ?? 0.5;
  const fs = p.big ? 96 : 52;
  const nameFs = p.big ? 30 : 18;
  const postW = Math.max(52, Math.min(p.big ? 200 : 120, width * 0.095));
  // The rope in each player's fur; the same fur on both sides: NO's part in the signal colour.
  const yesFur = p.cats?.yes ? FURS[p.cats.yes.fur].hex : C.ink;
  const noFurRaw = p.cats?.no ? FURS[p.cats.no.fur].hex : C.signal;
  const noFur = p.cats?.yes && p.cats?.no && p.cats.yes.fur === p.cats.no.fur ? C.signal : noFurRaw;

  // Paw trail: distinct recent positions, oldest faintest, alternating heights above the rope.
  const trail = (p.trail ?? []).map((t) => t.mid).filter((m, i, a) => i === 0 || Math.abs(m - a[i - 1]!) > 0.002).slice(-14);
  const levels: { side: 0 | 1; kind: "net" | "bowl"; own: number }[] = [];
  const lv = p.levels ?? {};
  if (lv.yes?.net) levels.push({ side: 0, kind: "net", own: lv.yes.net / 1e6 });
  if (lv.yes?.bowl) levels.push({ side: 0, kind: "bowl", own: lv.yes.bowl / 1e6 });
  if (lv.no?.net) levels.push({ side: 1, kind: "net", own: lv.no.net / 1e6 });
  if (lv.no?.bowl) levels.push({ side: 1, kind: "bowl", own: lv.no.bowl / 1e6 });

  const alt =
    price === null
      ? "Waiting for the price."
      : `A rope between two posts over a scale from 0 to 100 percent chance${p.sides ? ` that ${p.sides.yes}` : ""}. The cat stands at ${(price * 100).toFixed(1)} percent. ${p.names.yes}${p.sides ? ` (${p.sides.yes})` : ""}: $${yes!.toFixed(2)}. ${p.names.no}${p.sides ? ` (${p.sides.no})` : ""}: $${no!.toFixed(2)}.`;

  return (
    <figure role="group" aria-label={alt} style={{ margin: 0, display: "flex", flexDirection: "column", gap: p.big ? 20 : 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: nameFs, color: C.muted }}>
            <strong style={{ color: C.ink, fontWeight: 600 }}>{p.names.yes}</strong>
            {p.sides && <span style={{ display: "block", fontSize: Math.round(nameFs * 0.85) }}>{p.sides.yesShort}</span>}
          </span>
          <span style={{ fontFamily: F.cond, fontSize: fs, fontWeight: 600, lineHeight: 0.9 }}>{yes === null ? "–" : <Dollars v={yes} />}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-end", textAlign: "right" }}>
          <span style={{ fontSize: nameFs, color: C.muted }}>
            <strong style={{ color: C.signalInk, fontWeight: 600 }}>{p.names.no}</strong>
            {p.sides && <span style={{ display: "block", fontSize: Math.round(nameFs * 0.85) }}>{p.sides.noShort}</span>}
          </span>
          <span style={{ fontFamily: F.cond, fontSize: fs, fontWeight: 600, lineHeight: 0.9, color: C.signalInk }}>{no === null ? "–" : <Dollars v={no} />}</span>
        </div>
      </div>

      <div ref={stage} style={{ position: "relative", width: "100%", aspectRatio: `${VW} / ${VH}` }}>
        <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "visible" }}>
          <Ruler question={p.sides?.yes} />
          {levels.map((l, i) => (
            <Level key={i} {...l} who={l.side === 0 ? p.names.yes : p.names.no} />
          ))}
          {/* the posts */}
          <rect x={X0 - 8} y={TOP - 20} width="16" height={GROUND - TOP + 20} fill={C.ink} />
          <rect x={X0 + SPAN - 8} y={TOP - 20} width="16" height={GROUND - TOP + 20} fill={C.signal} />
          {/* the rope: an ink cord, filled with YES's fur up to the cat and NO's fur after it */}
          <path d={ropePath(0, 1)} fill="none" stroke={C.ink} strokeWidth={p.big ? 11 : 10} strokeLinecap="round" />
          <path d={ropePath(0, split)} fill="none" stroke={yesFur} strokeWidth={p.big ? 7 : 6} strokeLinecap="round" />
          <path d={ropePath(split, 1)} fill="none" stroke={noFur} strokeWidth={p.big ? 7 : 6} strokeLinecap="round" />
          {/* where the price has been */}
          {trail.map((m, i, a) => (
            <PawMark key={i} x={xOf(m)} y={yOf(m) - (i % 2 ? 20 : 32)} dir={i > 0 && m < a[i - 1]! ? -1 : 1} opacity={0.2 + (0.6 * (i + 1)) / a.length} />
          ))}
          {price !== null && p.phase !== "settled" && (
            <text
              x={Math.min(Math.max(xOf(price), X0 + 140), X0 + SPAN - 140)}
              y={30}
              textAnchor="middle"
              fontFamily="var(--font-barlow), Arial, sans-serif"
              fontSize="21"
              fontWeight="600"
              fill={C.ink}
            >
              {`the cat: ${(price * 100).toFixed(1)}% chance now`}
            </text>
          )}
        </svg>

        {p.cats?.yes && <PostCatView c={p.cats.yes} side={0} w={postW} />}
        {p.cats?.no && <PostCatView c={p.cats.no} side={1} w={postW} />}

        {/* the market cat, standing on the rope */}
        <div
          style={{
            position: "absolute",
            left: `${pctX(catP)}%`,
            top: `${pctY(catP)}%`,
            width: catW,
            transform: "translate(-50%, -88%)",
            transition: p.phase === "settled" ? "left 2600ms ease-in-out, top 2600ms ease-in-out" : "left 1200ms ease, top 1200ms ease",
          }}
        >
          <div style={{ position: "relative" }}>
            {p.window && (p.phase === "exit" || p.phase === "joining") && <Countdown start={p.window.start} end={p.window.end} now={p.window.now} />}
            <Cat pose={pose} size={catW} />
          </div>
        </div>

        {p.stamp && (
          <div
            style={{
              position: "absolute",
              right: "6%",
              top: "2%",
              transform: "rotate(-8deg)",
              border: `3px solid ${C.signal}`,
              color: C.signalInk,
              padding: p.big ? "10px 22px" : "4px 12px",
              fontFamily: F.cond,
              fontWeight: 700,
              fontSize: p.big ? 40 : 22,
              background: C.page,
            }}
          >
            {p.stamp}
          </div>
        )}
      </div>

      {p.window && (p.phase === "exit" || p.phase === "joining") && (
        <p aria-live="polite" style={{ margin: 0, textAlign: "center", fontSize: p.big ? 24 : 15, color: C.body }}>
          {p.window.now < p.window.start
            ? `${p.window.label}: measuring starts in a moment`
            : p.window.now < p.window.end
              ? `${p.window.label}: ${p.window.end - p.window.now} s of measuring left. Nothing else is needed from you; you can close this page.`
              : `${p.window.label}: the samplers are agreeing on the price`}
        </p>
      )}

      <figcaption style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", fontSize: p.big ? 20 : 14, color: C.muted }}>
        <span>
          Pot ${n.toFixed(2)}
          {p.startedAt && p.startedAt !== p.notional ? ` (started at $${money(p.startedAt).toFixed(2)})` : ""}.{" "}
          {price === null ? "Reading the price." : `The cat stands at ${(price * 100).toFixed(1)}% chance, averaged over 30 seconds.`}
        </span>
        <span>Data provided by Gemini.</span>
      </figcaption>
    </figure>
  );
}
