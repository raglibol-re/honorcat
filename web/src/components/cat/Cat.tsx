"use client";

import { useId } from "react";
import { C, F } from "./tokens";

/**
 * The HonorCat cat: one inline-SVG component, every pose of the pot's story. Always cute: round
 * body and head, big signal-coloured eyes with ink pupils, pointed ears, a tail that sways and an
 * occasional blink. Only the existing colours (tokens.ts). Motion lives in globals.css (.hc-cat-*)
 * and stops under prefers-reduced-motion. Every pose has a text alternative.
 */
export type CatPose =
  | "rope"
  | "wobble"
  | "crouch"
  | "air"
  | "land"
  | "net"
  | "bowl"
  | "paw"
  | "second"
  | "sleep"
  | "peek"
  | "box"
  | "lives";

export const POSE_TEXT: Record<CatPose, string> = {
  rope: "A black cat balancing on a rope, arms and tail out.",
  wobble: "A black cat wobbling on the rope: the price is moving fast.",
  crouch: "A black cat crouching, ready to jump: an exit was requested.",
  air: "A black cat in the air, legs out: the exit window is running.",
  land: "A black cat landing on its feet: the exit is done.",
  net: "A black cat resting in a net: the side's floor caught it.",
  bowl: "A black cat eating at its bowl: the side's target was reached.",
  paw: "A black cat holding out a paw: both sides shook hands.",
  second: "Two black cats: a second cat takes over a side.",
  sleep: "A black cat curled up asleep: waiting for someone to join.",
  peek: "A black cat peeking in from the edge: loading.",
  box: "A black cat looking into an empty box: nothing here.",
  lives: "Nine paw marks: the cat's lives.",
};

const VIEW: Record<CatPose, [number, number]> = {
  rope: [140, 110],
  wobble: [140, 110],
  crouch: [120, 100],
  air: [120, 110],
  land: [120, 104],
  net: [140, 110],
  bowl: [140, 100],
  paw: [120, 100],
  second: [200, 100],
  sleep: [140, 100],
  peek: [120, 80],
  box: [170, 100],
  lives: [180, 24],
};

const origin = (x: number, y: number) => ({ transformOrigin: `${x}px ${y}px`, transformBox: "view-box" as const });

/** Signal eyes with ink pupils and a page-coloured catchlight; they blink now and then. */
function Eyes({ cx, cy, open = true, look = 0 }: { cx: number; cy: number; open?: boolean; look?: number }) {
  if (!open) {
    return (
      <g fill="none" stroke={C.signal} strokeWidth="2.2" strokeLinecap="round">
        <path d={`M${cx - 12} ${cy} q4 3.5 8 0`} />
        <path d={`M${cx + 4} ${cy} q4 3.5 8 0`} />
      </g>
    );
  }
  return (
    <g className="hc-cat-blink" style={origin(cx, cy)}>
      {[-8, 8].map((dx) => (
        <g key={dx}>
          <ellipse cx={cx + dx} cy={cy} rx="5.6" ry="6.4" fill={C.signal} />
          <ellipse cx={cx + dx + look} cy={cy + 0.8} rx="2" ry="4.6" fill={C.ink} />
          <circle cx={cx + dx + 1.8 + look} cy={cy - 2.6} r="1.4" fill={C.page} />
        </g>
      ))}
    </g>
  );
}

/** Round head with pointed ears, centred on (cx, cy). */
function Head({ cx, cy, r = 20, eyesOpen = true, look = 0 }: { cx: number; cy: number; r?: number; eyesOpen?: boolean; look?: number }) {
  return (
    <g>
      <polygon
        points={`${cx - r * 0.92},${cy - r * 0.2} ${cx - r * 0.78},${cy - r * 1.55} ${cx - r * 0.18},${cy - r * 0.92}`}
        fill={C.ink}
        stroke={C.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <polygon
        points={`${cx + r * 0.18},${cy - r * 0.92} ${cx + r * 0.78},${cy - r * 1.55} ${cx + r * 0.92},${cy - r * 0.2}`}
        fill={C.ink}
        stroke={C.ink}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx={cx} cy={cy} r={r} fill={C.ink} />
      <Eyes cx={cx} cy={cy + 1} open={eyesOpen} look={look} />
      <path d={`M${cx - 2} ${cy + 9} h4 l-2 2.4 z`} fill={C.signal} />
    </g>
  );
}

/** The cute sitting cat, feet on y = base, centred on x. `tail`: how the tail sits. */
function Sitting({ x, base, tail = "up", eyesOpen = true, look = 0, feet = true }: { x: number; base: number; tail?: "up" | "out" | "low"; eyesOpen?: boolean; look?: number; feet?: boolean }) {
  const ty = base - 6;
  const tailD =
    tail === "out"
      ? `M${x + 18} ${ty - 8} C ${x + 34} ${ty - 12}, ${x + 44} ${ty - 22}, ${x + 54} ${ty - 18}`
      : tail === "low"
        ? `M${x + 18} ${ty} C ${x + 34} ${ty + 2}, ${x + 44} ${ty - 2}, ${x + 50} ${ty - 8}`
        : `M${x + 18} ${ty} C ${x + 40} ${ty}, ${x + 44} ${ty - 26}, ${x + 32} ${ty - 34}`;
  return (
    <g>
      <g className="hc-cat-tail" style={origin(x + 18, ty)}>
        <path d={tailD} fill="none" stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
      </g>
      <ellipse cx={x} cy={base - 20} rx="23" ry="21" fill={C.ink} />
      {feet && (
        <>
          <ellipse cx={x - 10} cy={base - 2} rx="8.5" ry="4.5" fill={C.ink} />
          <ellipse cx={x + 10} cy={base - 2} rx="8.5" ry="4.5" fill={C.ink} />
        </>
      )}
      <Head cx={x} cy={base - 48} eyesOpen={eyesOpen} look={look} />
    </g>
  );
}

/** One paw print centred on (x, y), filled or as an outline. */
function PawMark({ x, y, filled, s = 1 }: { x: number; y: number; filled: boolean; s?: number }) {
  const fill = filled ? C.ink : "none";
  const stroke = filled ? "none" : C.faint;
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} fill={fill} stroke={stroke} strokeWidth="1.2">
      <ellipse cx="0" cy="3" rx="5" ry="4.2" />
      <circle cx="-5.2" cy="-3.4" r="2" />
      <circle cx="-1.8" cy="-6.4" r="2" />
      <circle cx="2" cy="-6.4" r="2" />
      <circle cx="5.4" cy="-3.4" r="2" />
    </g>
  );
}

function Scene({ pose, lives, uid }: { pose: CatPose; lives: number; uid: string }) {
  switch (pose) {
    case "rope":
    case "wobble": {
      const wob = pose === "wobble";
      return (
        <>
          <path d="M0 96 Q70 102 140 96" fill="none" stroke={C.ink} strokeWidth="2.5" />
          <g className={wob ? "hc-cat-wobble" : "hc-cat-balance"} style={origin(70, 96)}>
            {/* arms out for balance */}
            <path d="M52 70 L30 62" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
            <path d="M88 70 L110 62" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
            <Sitting x={70} base={96} tail="out" look={wob ? 1.4 : 0} />
          </g>
          {wob && (
            <g stroke={C.ink} strokeWidth="2" strokeLinecap="round">
              <path d="M14 50 l8 4" />
              <path d="M12 62 l9 1" />
              <path d="M126 50 l-8 4" />
              <path d="M128 62 l-9 1" />
            </g>
          )}
        </>
      );
    }
    case "crouch":
      return (
        <>
          <line x1="0" y1="96" x2="120" y2="96" stroke={C.ink} strokeWidth="2" />
          <g transform="translate(-4.8 19.2) scale(1.08 0.8)">
            <Sitting x={60} base={96} tail="low" />
          </g>
          <g stroke={C.ink} strokeWidth="2" strokeLinecap="round">
            <path d="M22 30 l6 6" />
            <path d="M98 30 l-6 6" />
          </g>
        </>
      );
    case "air":
      return (
        <>
          <ellipse cx="60" cy="104" rx="22" ry="2.5" fill={C.faint} />
          <g className="hc-cat-float" style={origin(60, 60)}>
            <g transform="rotate(-8 60 60)">
              {/* legs out */}
              <path d="M44 74 L32 90" stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
              <path d="M76 74 L88 90" stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
              <path d="M48 52 L30 40" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
              <path d="M72 52 L90 40" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
              <Sitting x={60} base={86} tail="up" feet={false} />
            </g>
          </g>
        </>
      );
    case "land":
      return (
        <>
          <line x1="0" y1="96" x2="120" y2="96" stroke={C.ink} strokeWidth="2" />
          <Sitting x={60} base={96} tail="up" />
          <g stroke={C.ink} strokeWidth="2" strokeLinecap="round">
            <path d="M24 92 l-10 -4" />
            <path d="M26 86 l-8 -8" />
            <path d="M96 92 l10 -4" />
            <path d="M94 86 l8 -8" />
          </g>
        </>
      );
    case "net": {
      const meshId = `${uid}-mesh`;
      return (
        <>
          <defs>
            <clipPath id={meshId}>
              <path d="M10 66 Q70 118 130 66 Z" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${meshId})`} stroke={C.ink} strokeWidth="1.2">
            {Array.from({ length: 14 }, (_, i) => (
              <line key={`a${i}`} x1={i * 12 - 30} y1="60" x2={i * 12 + 20} y2="110" />
            ))}
            {Array.from({ length: 14 }, (_, i) => (
              <line key={`b${i}`} x1={i * 12 + 20} y1="60" x2={i * 12 - 30} y2="110" />
            ))}
          </g>
          <path d="M10 66 Q70 118 130 66" fill="none" stroke={C.ink} strokeWidth="2.5" />
          <line x1="10" y1="66" x2="10" y2="30" stroke={C.ink} strokeWidth="2.5" />
          <line x1="130" y1="66" x2="130" y2="30" stroke={C.ink} strokeWidth="2.5" />
          {/* curled up, eyes open, resting */}
          <ellipse cx="74" cy="76" rx="30" ry="15" fill={C.ink} />
          <path d="M100 82 C 110 90, 92 96, 70 92" fill="none" stroke={C.ink} strokeWidth="6" strokeLinecap="round" />
          <Head cx={48} cy={66} r={16} />
        </>
      );
    }
    case "bowl":
      return (
        <>
          <line x1="0" y1="96" x2="140" y2="96" stroke={C.ink} strokeWidth="2" />
          <g transform="rotate(14 54 96)">
            <Sitting x={54} base={96} tail="up" look={2} />
          </g>
          <path d="M84 96 L120 96 L115 82 L89 82 Z" fill={C.signal} />
          <path d="M92 82 Q102 72 112 82 Z" fill={C.ink} />
        </>
      );
    case "paw":
      return (
        <>
          <line x1="0" y1="96" x2="120" y2="96" stroke={C.ink} strokeWidth="2" />
          <Sitting x={56} base={96} tail="up" />
          <path d="M70 66 Q88 62 98 52" fill="none" stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
          <PawMark x={100} y={46} filled s={0.9} />
        </>
      );
    case "second":
      return (
        <>
          <line x1="0" y1="96" x2="200" y2="96" stroke={C.ink} strokeWidth="2" />
          <Sitting x={46} base={96} tail="up" look={2} />
          <g transform="translate(200 0) scale(-1 1)">
            <Sitting x={46} base={96} tail="up" look={2} />
          </g>
        </>
      );
    case "sleep":
      return (
        <>
          <line x1="0" y1="96" x2="140" y2="96" stroke={C.ink} strokeWidth="2" />
          <path d="M100 90 C 118 94, 112 70, 100 72" fill="none" stroke={C.ink} strokeWidth="6" strokeLinecap="round" className="hc-cat-tail" style={origin(100, 90)} />
          <ellipse cx="74" cy="80" rx="34" ry="16" fill={C.ink} />
          <Head cx={46} cy={74} r={17} eyesOpen={false} />
          <g className="hc-cat-z" fill={C.ink} style={{ fontFamily: F.cond, fontWeight: 700 }}>
            <text x="92" y="44" fontSize="18">Z</text>
            <text x="108" y="30" fontSize="13">z</text>
          </g>
        </>
      );
    case "peek": {
      const clipId = `${uid}-edge`;
      return (
        <>
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width="120" height="60" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${clipId})`}>
            <g className="hc-cat-peek" style={origin(60, 60)}>
              <Head cx={60} cy={54} r={22} look={1.5} />
            </g>
          </g>
          <line x1="0" y1="60" x2="120" y2="60" stroke={C.ink} strokeWidth="3" />
          <ellipse cx="44" cy="58" rx="8" ry="4.5" fill={C.ink} />
          <ellipse cx="76" cy="58" rx="8" ry="4.5" fill={C.ink} />
        </>
      );
    }
    case "box":
      return (
        <>
          <line x1="0" y1="96" x2="170" y2="96" stroke={C.ink} strokeWidth="2" />
          <g transform="rotate(10 52 96)">
            <Sitting x={52} base={96} tail="up" look={2.4} />
          </g>
          {/* an open, empty box */}
          <rect x="100" y="62" width="56" height="34" fill="none" stroke={C.ink} strokeWidth="2.5" />
          <path d="M100 62 L90 48" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M156 62 L166 48" stroke={C.ink} strokeWidth="2.5" strokeLinecap="round" />
          <line x1="100" y1="62" x2="156" y2="62" stroke={C.ink} strokeWidth="2.5" />
        </>
      );
    case "lives":
      return (
        <>
          {Array.from({ length: 9 }, (_, i) => (
            <PawMark key={i} x={10 + i * 20} y={13} filled={i < lives} s={0.95} />
          ))}
        </>
      );
  }
}

/**
 * `<Cat pose="rope" size={160} />`. `size` is the width in px; the height follows the pose.
 * `label` overrides the text alternative; `lives` (0..9) fills paw marks for pose "lives".
 */
export function Cat({ pose, size = 160, label, lives = 9 }: { pose: CatPose; size?: number; label?: string; lives?: number }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [w, h] = VIEW[pose];
  const n = Math.max(0, Math.min(9, Math.round(lives)));
  const text = label ?? (pose === "lives" ? `${n} of 9 lives left.` : POSE_TEXT[pose]);
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      role="img"
      aria-label={text}
      style={{ display: "block", overflow: "visible" }}
    >
      <title>{text}</title>
      <Scene pose={pose} lives={n} uid={uid} />
    </svg>
  );
}
