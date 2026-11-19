"use client";

import { formatAmount } from "@/lib/amount";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Cat,
  type CatPose,
  type Cosmetic,
  type Mood,
} from "@/components/cat/Cat";
import { FURS, type Fur } from "@/lib/names";
import { splitPot } from "@/lib/shares";
import { RollingNumber } from "@/components/cat/RollingNumber";
import { C, F } from "@/components/cat/tokens";
import { money as fmt, useHome } from "@/lib/currency";

export type RopePhase =
  "waiting" | "joining" | "live" | "exit" | "divided" | "settled" | "expired";
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
  /**
   * A short rope (HonorCat v2): the posts as YES chances 0..1 and the extra lives each side bought.
   * The rope hangs between the posts; past a post a side has all or nothing (the clamp).
   */
  posts?: {
    lower: number;
    upper: number;
    livesYes?: number;
    livesNo?: number;
  } | null;
  /** Show only this part of the scale (YES chances 0..1), e.g. a perp's rope with a margin. */
  zoom?: readonly [number, number];
  /** A closed pot's final state in words ("Settled by Gemini: YES."), shown instead of the live price. */
  final?: string | null;
};
export type PostCat = {
  fur: Fur;
  mood: Mood;
  name: string;
  wear?: Cosmetic | null;
  /** On a copied side: the player this side copies, drawn as a small shadow cat behind. */
  copies?: string | null;
};

/* The drawing, in the approved mockup's units: 1440 wide, the 0..100 scale from x 40 to x 1400. */
const VW = 1440;
const VH = 330;
const X0 = 40;
const SPAN = 1360;
const GROUND = 250; // the ruler's baseline
const TOP = 118; // where the rope leaves the posts
const SAG = 26;
/** The part of the 0..1 scale the drawing shows (a perp's rope zooms to its posts). */
type Zoom = readonly [number, number];
const ZoomCtx = createContext<Zoom>([0, 1]);
const unit = (z: Zoom, p: number) =>
  Math.min(1, Math.max(0, (p - z[0]) / Math.max(1e-9, z[1] - z[0])));
const xOf = (z: Zoom, p: number) => X0 + SPAN * unit(z, p);
const yOf = (z: Zoom, p: number) =>
  TOP + SAG * 4 * unit(z, p) * (1 - unit(z, p));
const pctX = (z: Zoom, p: number) => (xOf(z, p) / VW) * 100;
const pctY = (z: Zoom, p: number) => (yOf(z, p) / VH) * 100;

function poseFor(p: RopeProps): CatPose {
  if (p.phase === "waiting") return "sleep";
  if (p.phase === "expired") return "box";
  if (p.phase === "settled") return p.receiver === 2 ? "box" : "land";
  if (p.phase === "divided") return "land";
  if ((p.phase === "exit" || p.phase === "joining") && p.window)
    return p.window.now < p.window.start
      ? "crouch"
      : p.phase === "exit"
        ? "air"
        : "rope";
  if (p.price === null) return "peek";
  return (p.speed ?? 0) > 1.5 ? "wobble" : "rope";
}

/** Dollars that roll like an odometer; screen readers get the plain amount. */
function Dollars({ v }: { v: number }) {
  const { home, rate } = useHome();
  const eur = home === "EURC" && rate;
  const sym = eur ? "€" : "$";
  const cents = Math.round(v * (eur ? rate.eurcPerUsdc : 1) * 100);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      <span className="hc-sr">{`${sym}${(cents / 100).toFixed(2)}`}</span>
      <span
        aria-hidden="true"
        style={{ display: "inline-flex", alignItems: "baseline" }}
      >
        {sym}
        <RollingNumber value={Math.floor(cents / 100)} />.
        {String(cents % 100).padStart(2, "0")}
      </span>
    </span>
  );
}

/** A post of a short rope: where it stands (YES chance), labelled, with one paw mark per extra life. */
function RopePost({
  at,
  side,
  lives,
  who,
}: {
  at: number;
  side: 0 | 1;
  lives: number;
  who: string;
}) {
  const z = useContext(ZoomCtx);
  const x = xOf(z, at);
  // Beside the post, on the outer side (away from the rope), at mid height: clear of the cat.
  const left = side === 0 ? x > X0 + 160 : x > X0 + SPAN - 160;
  return (
    <g>
      <text
        x={left ? x - 16 : x + 16}
        y={GROUND - 54}
        textAnchor={left ? "end" : "start"}
        fontFamily="var(--font-barlow), Arial, sans-serif"
        fontSize="19"
        fontWeight="600"
        fill={side === 0 ? C.ink : C.signalInk}
      >
        {`${/^you( |$)/.test(who) ? "your" : `${who}'s`} post: ${(at * 100).toFixed(0)}`}
      </text>
      {Array.from({ length: lives }, (_, i) => (
        <PawMark
          key={i}
          x={x + (side === 0 ? -1 : 1) * (26 + i * 24)}
          y={GROUND - 16}
          dir={side === 0 ? -1 : 1}
          opacity={0.85}
        />
      ))}
    </g>
  );
}

function ropePath(z: Zoom, from: number, to: number) {
  const pts: string[] = [];
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const p = from + ((to - from) * i) / n;
    pts.push(`${xOf(z, p).toFixed(1)},${yOf(z, p).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/**
 * The approved mockup's ruler: a tick every point, medium every 5, labelled every 10 (every 5 when
 * zoomed in to a short rope), in real points of the YES chance.
 */
function Ruler({ question }: { question?: string }) {
  const z = useContext(ZoomCtx);
  const from = Math.ceil(z[0] * 100 - 1e-9);
  const to = Math.floor(z[1] * 100 + 1e-9);
  const span = to - from;
  const label = span <= 50 ? 5 : 10;
  const ticks = [];
  for (let i = from; i <= to; i++) {
    const x = xOf(z, i / 100);
    const major = i % label === 0;
    const mid = !major && i % 5 === 0;
    ticks.push(
      <line
        key={i}
        x1={x}
        y1={GROUND - (major ? 34 : mid ? 24 : 14)}
        x2={x}
        y2={GROUND}
        stroke={C.ink}
        strokeWidth={major ? 2 : mid ? 1.5 : 1}
      />,
    );
    if (major)
      ticks.push(
        <text
          key={`t${i}`}
          x={x}
          y={GROUND + 30}
          textAnchor="middle"
          fontFamily="var(--font-barlow-condensed), 'Arial Narrow', sans-serif"
          fontSize="22"
          fontWeight="500"
          fill={C.ink}
        >
          {i}
        </text>,
      );
  }
  return (
    <g aria-hidden="true">
      <line
        x1={X0}
        y1={GROUND}
        x2={X0 + SPAN}
        y2={GROUND}
        stroke={C.ink}
        strokeWidth="2"
      />
      {ticks}
      <text
        x={X0 + SPAN}
        y={GROUND + 58}
        textAnchor="end"
        fontFamily="var(--font-barlow), Arial, sans-serif"
        fontSize="17"
        fill={C.muted}
      >
        {question
          ? `% chance that ${question.length > 70 ? `${question.slice(0, 68)}…` : question}`
          : "% chance"}
      </text>
    </g>
  );
}

function PawMark({
  x,
  y,
  dir,
  opacity,
}: {
  x: number;
  y: number;
  dir: 1 | -1;
  opacity: number;
}) {
  return (
    <g
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${dir * 90}) scale(0.95)`}
      fill={C.dash}
      opacity={opacity}
    >
      <ellipse cx="0" cy="3" rx="6" ry="5" />
      <circle cx="-6.2" cy="-4" r="2.4" />
      <circle cx="-2.2" cy="-7.6" r="2.4" />
      <circle cx="2.4" cy="-7.6" r="2.4" />
      <circle cx="6.4" cy="-4" r="2.4" />
    </g>
  );
}

/** A side's net (a hammock under the rope) or bowl (on the ground), with the zone where it acts. */
function Level({
  side,
  kind,
  own,
  who,
}: {
  side: 0 | 1;
  kind: "net" | "bowl";
  own: number;
  who: string;
}) {
  const z = useContext(ZoomCtx);
  // The YES price at which this side's own price reaches the level.
  const p = side === 0 ? own : 1 - own;
  const x = xOf(z, p);
  const y = yOf(z, p);
  const zone =
    kind === "net"
      ? side === 0
        ? [0, p]
        : [p, 1]
      : side === 0
        ? [p, 1]
        : [0, p];
  const color = side === 0 ? C.ink : C.signal;
  const label = `${/^you( |$)/.test(who) ? "your" : `${who}'s`} ${kind} at ${(own * 100).toFixed(0)}%`;
  return (
    <g>
      <rect
        x={xOf(z, zone[0]!)}
        y={TOP + 40}
        width={Math.max(0, xOf(z, zone[1]!) - xOf(z, zone[0]!))}
        height={GROUND - TOP - 40}
        fill={kind === "bowl" ? C.signal : C.ink}
        opacity={kind === "bowl" ? 0.12 : 0.06}
      />
      {kind === "net" ? (
        <g stroke={color} fill="none">
          <path
            d={`M${x - 46} ${y + 6} Q${x} ${y + 64} ${x + 46} ${y + 6}`}
            strokeWidth="2.5"
          />
          <path
            d={`M${x - 30} ${y + 18} L${x - 18} ${y + 40} M${x - 10} ${y + 26} L${x - 2} ${y + 44} M${x + 10} ${y + 26} L${x + 2} ${y + 44} M${x + 30} ${y + 18} L${x + 18} ${y + 40} M${x - 36} ${y + 24} L${x + 36} ${y + 24}`}
            strokeWidth="1.2"
          />
        </g>
      ) : (
        <g>
          <path
            d={`M${x - 30} ${GROUND} L${x + 30} ${GROUND} L${x + 22} ${GROUND - 24} L${x - 22} ${GROUND - 24} Z`}
            fill={C.signal}
          />
          <path
            d={`M${x - 18} ${GROUND - 24} Q${x} ${GROUND - 42} ${x + 18} ${GROUND - 24} Z`}
            fill={C.ink}
          />
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
function Countdown({
  start,
  end,
  now,
}: {
  start: number;
  end: number;
  now: number;
}) {
  const total = Math.max(1, end - start);
  const left = Math.max(0, Math.min(total, end - now));
  const waiting = now < start;
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 100 100"
      aria-hidden="true"
      style={{
        position: "absolute",
        left: "-14%",
        top: "-14%",
        width: "128%",
        height: "128%",
      }}
    >
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={C.faint}
        strokeWidth="3"
      />
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
function PostCatView({
  c,
  side,
  w,
  at,
}: {
  c: PostCat;
  side: 0 | 1;
  w: number;
  at?: number;
}) {
  const z = useContext(ZoomCtx);
  return (
    <div
      style={{
        position: "absolute",
        left: `${pctX(z, at ?? side)}%`,
        top: `${((TOP - 20) / VH) * 100}%`,
        width: w,
        // Keep the cats inside the stage (no sideways scrolling on phones) and facing the rope.
        transform: `translate(${side === 0 ? "-30%" : "-70%"}, -92%) scaleX(${side === 0 ? 1 : -1})`,
      }}
    >
      {c.copies && (
        <div style={{ position: "absolute", left: "-38%", bottom: 0, width: w * 0.62, opacity: 0.35, filter: "grayscale(1)" }}>
          <Cat pose="sit" size={w * 0.62} fur={FURS.black} mood="even" label={`a shadow cat: this side copies ${c.copies}`} />
        </div>
      )}
      <Cat
        pose="sit"
        size={w}
        fur={FURS[c.fur]}
        wear={c.wear ?? null}
        mood={c.mood}
        label={`${c.name}'s cat, on the ${side === 0 ? "YES" : "NO"} post${c.copies ? `, copying ${c.copies}` : ""}`}
      />
    </div>
  );
}

/**
 * An open seat on a post: no cat, only the dashed outline of where one will sit, and the words
 * "open seat". The same place and size as a player's cat, so it reads as a cat that is still missing.
 */
function EmptySeatView({
  side,
  w,
  at,
}: {
  side: 0 | 1;
  w: number;
  at?: number;
}) {
  const z = useContext(ZoomCtx);
  // The sitting cat's parts (shapes.tsx SittingCat). Drawn twice: a wide dashed stroke underneath,
  // then pale fills on top, so only one dashed outline around the whole cat remains visible.
  const parts = (props: React.SVGProps<SVGElement>) => (
    <>
      <path
        d="M94 122 C 128 122, 126 80, 104 74"
        {...(props as React.SVGProps<SVGPathElement>)}
        fill="none"
      />
      <ellipse
        cx="64"
        cy="98"
        rx="34"
        ry="40"
        {...(props as React.SVGProps<SVGEllipseElement>)}
      />
      <circle
        cx="44"
        cy="46"
        r="25"
        {...(props as React.SVGProps<SVGCircleElement>)}
      />
      <polygon
        points="22,38 26,6 44,26"
        {...(props as React.SVGProps<SVGPolygonElement>)}
      />
      <polygon
        points="46,24 62,6 66,38"
        {...(props as React.SVGProps<SVGPolygonElement>)}
      />
      <ellipse
        cx="44"
        cy="135"
        rx="13"
        ry="6"
        {...(props as React.SVGProps<SVGEllipseElement>)}
      />
      <ellipse
        cx="70"
        cy="135"
        rx="13"
        ry="6"
        {...(props as React.SVGProps<SVGEllipseElement>)}
      />
    </>
  );
  return (
    <div
      role="img"
      aria-label={`Open seat on the ${side === 0 ? "YES" : "NO"} post: nobody has taken this side yet`}
      style={{
        position: "absolute",
        left: `${pctX(z, at ?? side)}%`,
        top: `${((TOP - 20) / VH) * 100}%`,
        width: w,
        transform: `translate(${side === 0 ? "-30%" : "-70%"}, -92%)`,
      }}
    >
      <svg
        viewBox="-6 -6 142 152"
        width="100%"
        aria-hidden="true"
        style={{
          display: "block",
          transform: side === 1 ? "scaleX(-1)" : undefined,
          overflow: "visible",
        }}
      >
        <g>
          {parts({
            fill: "none",
            stroke: C.dash,
            strokeWidth: 8,
            strokeDasharray: "9 7",
            strokeLinejoin: "round",
            strokeLinecap: "round",
          })}
        </g>
        <g>{parts({ fill: C.grid, stroke: C.grid, strokeWidth: 0 })}</g>
        {/* the tail as a pale line over its own dashed edge */}
        <path
          d="M94 122 C 128 122, 126 80, 104 74"
          fill="none"
          stroke={C.grid}
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      {/* under the seat, aligned on the post so it stays on screen at either end */}
      <span
        style={{
          position: "absolute",
          top: "100%",
          [side === 0 ? "left" : "right"]: "calc(30% + 12px)",
          marginTop: 4,
          fontSize: Math.max(12, Math.round(w / 6.5)),
          color: C.muted,
          whiteSpace: "nowrap",
        }}
      >
        open seat
      </span>
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
  const z: Zoom = p.zoom ?? [0, 1];
  // A short rope hangs between its posts; a normal pot between 0 and 100.
  const lo = p.posts?.lower ?? 0;
  const hi = p.posts?.upper ?? 1;
  // On a rope a side's share follows the price between the posts and is all or nothing past them.
  const along = (q: number) =>
    (Math.min(hi, Math.max(lo, q)) - lo) / Math.max(1e-9, hi - lo);
  // One side rounded to the cent, the other the pot minus it: the two always add up to the pot.
  const shares =
    price === null
      ? null
      : splitPot(p.notional, p.posts ? along(price) : price);
  const yes = shares === null ? null : Number(shares.yes) / 1e6;
  const no = shares === null ? null : Number(shares.no) / 1e6;
  const pose = poseFor(p);
  const open = p.phase === "waiting" || p.phase === "joining";
  // On a short rope the cat stays on the rope: past a post it waits at the post (the caption says the price).
  const catP =
    p.phase === "settled" && (p.receiver === 0 || p.receiver === 1)
      ? p.receiver === 0
        ? lo
        : hi
      : Math.min(hi, Math.max(lo, price ?? (lo + hi) / 2));
  const catW = Math.max(56, Math.min(p.big ? 260 : 150, width * 0.1));
  const split = Math.min(hi, Math.max(lo, price ?? (lo + hi) / 2));
  const fs = p.big ? 96 : 52;
  const nameFs = p.big ? 30 : 18;
  const postW = Math.max(52, Math.min(p.big ? 200 : 120, width * 0.095));
  // The rope in each player's fur; the same fur on both sides: NO's part in the signal colour.
  const yesFur = p.cats?.yes ? FURS[p.cats.yes.fur].hex : C.ink;
  const noFurRaw = p.cats?.no ? FURS[p.cats.no.fur].hex : C.signal;
  const noFur =
    p.cats?.yes && p.cats?.no && p.cats.yes.fur === p.cats.no.fur
      ? C.signal
      : noFurRaw;

  // Paw trail: distinct recent positions, oldest faintest, alternating heights above the rope.
  const trail = (p.trail ?? [])
    .map((t) => t.mid)
    .filter((m, i, a) => i === 0 || Math.abs(m - a[i - 1]!) > 0.002)
    .slice(-14);
  const levels: { side: 0 | 1; kind: "net" | "bowl"; own: number }[] = [];
  const lv = p.levels ?? {};
  if (lv.yes?.net) levels.push({ side: 0, kind: "net", own: lv.yes.net / 1e6 });
  if (lv.yes?.bowl)
    levels.push({ side: 0, kind: "bowl", own: lv.yes.bowl / 1e6 });
  if (lv.no?.net) levels.push({ side: 1, kind: "net", own: lv.no.net / 1e6 });
  if (lv.no?.bowl)
    levels.push({ side: 1, kind: "bowl", own: lv.no.bowl / 1e6 });

  const alt =
    price === null
      ? "Waiting for the price."
      : `A rope between two posts${p.posts ? ` at ${(lo * 100).toFixed(0)} and ${(hi * 100).toFixed(0)}` : ""} over a scale from 0 to 100 percent chance${p.sides ? ` that ${p.sides.yes}` : ""}. The cat stands at ${(price * 100).toFixed(1)} percent. ${p.names.yes}${p.sides ? ` (${p.sides.yes})` : ""}: ${formatAmount(yes!)}. ${p.names.no}${p.sides ? ` (${p.sides.no})` : ""}: ${formatAmount(no!)}.`;

  return (
    <figure
      role="group"
      aria-label={alt}
      style={{
        margin: 0,
        display: "flex",
        flexDirection: "column",
        gap: p.big ? 20 : 10,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: nameFs, color: C.muted }}>
            <strong style={{ color: C.ink, fontWeight: 600 }}>
              {p.names.yes}
            </strong>
            {p.sides && (
              <span
                style={{
                  display: "block",
                  fontSize: Math.round(nameFs * 0.85),
                }}
              >
                {p.sides.yesShort}
              </span>
            )}
          </span>
          <span
            style={{
              fontFamily: F.cond,
              fontSize: fs,
              fontWeight: 600,
              lineHeight: 0.9,
            }}
          >
            {yes === null ? "–" : <Dollars v={yes} />}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            alignItems: "flex-end",
            textAlign: "right",
          }}
        >
          <span style={{ fontSize: nameFs, color: C.muted }}>
            <strong style={{ color: C.signalInk, fontWeight: 600 }}>
              {p.names.no}
            </strong>
            {p.sides && (
              <span
                style={{
                  display: "block",
                  fontSize: Math.round(nameFs * 0.85),
                }}
              >
                {p.sides.noShort}
              </span>
            )}
          </span>
          <span
            style={{
              fontFamily: F.cond,
              fontSize: fs,
              fontWeight: 600,
              lineHeight: 0.9,
              color: C.signalInk,
            }}
          >
            {no === null ? "–" : <Dollars v={no} />}
          </span>
        </div>
      </div>

      <ZoomCtx.Provider value={z}>
        <div
          ref={stage}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: `${VW} / ${VH}`,
          }}
        >
          <svg
            viewBox={`0 0 ${VW} ${VH}`}
            width="100%"
            height="100%"
            aria-hidden="true"
            style={{ position: "absolute", inset: 0, overflow: "visible" }}
          >
            <Ruler question={p.sides?.yes} />
            {levels.map((l, i) => (
              <Level
                key={i}
                {...l}
                who={l.side === 0 ? p.names.yes : p.names.no}
              />
            ))}
            {/* the posts (on a short rope: where the rope is tied, labelled, with paw marks for extra lives) */}
            <rect
              x={xOf(z, lo) - 8}
              y={yOf(z, lo) - 20}
              width="16"
              height={GROUND - yOf(z, lo) + 20}
              fill={C.ink}
            />
            <rect
              x={xOf(z, hi) - 8}
              y={yOf(z, hi) - 20}
              width="16"
              height={GROUND - yOf(z, hi) + 20}
              fill={C.signal}
            />
            {p.posts && lo > 0 && (
              <RopePost
                at={lo}
                side={0}
                lives={p.posts.livesYes ?? 0}
                who={p.names.yes}
              />
            )}
            {p.posts && hi < 1 && (
              <RopePost
                at={hi}
                side={1}
                lives={p.posts.livesNo ?? 0}
                who={p.names.no}
              />
            )}
            {/* the rope: an ink cord, filled with YES's fur up to the cat and NO's fur after it */}
            <path
              d={ropePath(z, lo, hi)}
              fill="none"
              stroke={C.ink}
              strokeWidth={p.big ? 11 : 10}
              strokeLinecap="round"
            />
            <path
              d={ropePath(z, lo, split)}
              fill="none"
              stroke={yesFur}
              strokeWidth={p.big ? 7 : 6}
              strokeLinecap="round"
            />
            <path
              d={ropePath(z, split, hi)}
              fill="none"
              stroke={noFur}
              strokeWidth={p.big ? 7 : 6}
              strokeLinecap="round"
            />
            {/* where the price has been */}
            {trail.map((m, i, a) => (
              <PawMark
                key={i}
                x={xOf(z, m)}
                y={yOf(z, m) - (i % 2 ? 20 : 32)}
                dir={i > 0 && m < a[i - 1]! ? -1 : 1}
                opacity={0.2 + (0.6 * (i + 1)) / a.length}
              />
            ))}
            {price !== null && p.phase !== "settled" && (
              <text
                x={Math.min(Math.max(xOf(z, price), X0 + 140), X0 + SPAN - 140)}
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

          {/* a player's cat on its post; while the pot waits for a player, the empty side shows an open seat */}
          {p.cats?.yes ? (
            <PostCatView c={p.cats.yes} side={0} w={postW} at={lo} />
          ) : (
            p.cats && open && <EmptySeatView side={0} w={postW} at={lo} />
          )}
          {p.cats?.no ? (
            <PostCatView c={p.cats.no} side={1} w={postW} at={hi} />
          ) : (
            p.cats && open && <EmptySeatView side={1} w={postW} at={hi} />
          )}

          {/* the market cat, standing on the rope */}
          <div
            style={{
              position: "absolute",
              left: `${pctX(z, catP)}%`,
              top: `${pctY(z, catP)}%`,
              width: catW,
              transform: "translate(-50%, -88%)",
              transition:
                p.phase === "settled"
                  ? "left 2600ms ease-in-out, top 2600ms ease-in-out"
                  : "left 1200ms ease, top 1200ms ease",
            }}
          >
            <div style={{ position: "relative" }}>
              {p.window && (p.phase === "exit" || p.phase === "joining") && (
                <Countdown
                  start={p.window.start}
                  end={p.window.end}
                  now={p.window.now}
                />
              )}
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
      </ZoomCtx.Provider>

      {p.window && (p.phase === "exit" || p.phase === "joining") && (
        <p
          aria-live="polite"
          style={{
            margin: 0,
            textAlign: "center",
            fontSize: p.big ? 24 : 15,
            color: C.body,
          }}
        >
          {p.window.now < p.window.start
            ? `${p.window.label}: measuring starts in a moment`
            : p.window.now < p.window.end
              ? `${p.window.label}: ${p.window.end - p.window.now} s of measuring left. Nothing else is needed from you; you can close this page.`
              : `${p.window.label}: the samplers are agreeing on the price`}
        </p>
      )}

      <figcaption
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          fontSize: p.big ? 20 : 14,
          color: C.muted,
        }}
      >
        <span>
          Pot {fmt(p.notional)}
          {p.startedAt && p.startedAt !== p.notional
            ? ` (started at ${fmt(p.startedAt)})`
            : ""}
          .{" "}
          {p.final
            ? p.final
            : price === null
              ? "Reading the price."
              : `The cat stands at ${(price * 100).toFixed(1)}% chance, averaged over 30 seconds.`}
        </span>
        <span>Data provided by Gemini.</span>
      </figcaption>
    </figure>
  );
}
