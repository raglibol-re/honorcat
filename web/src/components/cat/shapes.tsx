/**
 * The HonorCat shapes, taken unchanged from the design references (docs/design/*.html):
 * the cat head, the sitting cat, the paw print, the bowl, the closing block's ears and eyes.
 * Coordinates are the reference's own; only position, scale and colour are parameters.
 */
import { C } from "./tokens";

const HEAD = "M2 3 L6 7 L14 7 L18 3 L18 13 L15 17 L5 17 L2 13 Z";

/** Cat head in a 20×20 box. `eyes` adds the two eyes; `outline` draws it as a stroke. */
export function CatHead({
  width,
  height,
  fill = C.ink,
  eyes,
  outline,
  style,
}: {
  width: number;
  height: number;
  fill?: string;
  eyes?: string;
  outline?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <svg width={width} height={height} viewBox="0 0 20 20" aria-hidden="true" style={{ flex: "none", ...style }}>
      {outline ? <path d={HEAD} fill="none" stroke={fill} strokeWidth="1.6" strokeLinejoin="round" /> : <path d={HEAD} fill={fill} />}
      {eyes && (
        <>
          <ellipse cx="7.4" cy="11" rx="1.1" ry="1.7" fill={eyes} />
          <ellipse cx="12.6" cy="11" rx="1.1" ry="1.7" fill={eyes} />
        </>
      )}
    </svg>
  );
}

/** The bare head path, for use inside another SVG. */
export function CatHeadShape({ x, y, scale, fill = C.ink }: { x: number; y: number; scale: number; fill?: string }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <path d={HEAD} fill={fill} />
    </g>
  );
}

/** Paw print centred on (x, y). */
export function Paw({ x, y, rotate, scale, fill = C.ink }: { x: number; y: number; rotate: number; scale: number; fill?: string }) {
  return (
    <g className="hc-glide" style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${rotate}deg) scale(${scale})` }} fill={fill}>
      <ellipse cx="0" cy="3" rx="6" ry="5" />
      <circle cx="-6.2" cy="-4" r="2.4" />
      <circle cx="-2.2" cy="-7.6" r="2.4" />
      <circle cx="2.4" cy="-7.6" r="2.4" />
      <circle cx="6.4" cy="-4" r="2.4" />
    </g>
  );
}

/** The sitting cat (about 130×141 at scale 1), its top-left at (x, y). */
export function SittingCat({ x, y, scale = 1 }: { x: number; y: number; scale?: number }) {
  return (
    <g className="hc-glide" style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale})` }}>
      <path d="M94 122 C 128 122, 126 80, 104 74" fill="none" stroke={C.ink} strokeWidth="11" strokeLinecap="round" />
      <ellipse cx="64" cy="98" rx="34" ry="40" fill={C.ink} />
      <circle cx="44" cy="46" r="25" fill={C.ink} />
      <polygon points="22,38 26,6 44,26" fill={C.ink} />
      <polygon points="46,24 62,6 66,38" fill={C.ink} />
      <ellipse cx="44" cy="135" rx="13" ry="6" fill={C.ink} />
      <ellipse cx="70" cy="135" rx="13" ry="6" fill={C.ink} />
      <ellipse cx="35" cy="46" rx="3.6" ry="5.2" fill={C.signal} />
      <ellipse cx="52" cy="46" rx="3.6" ry="5.2" fill={C.signal} />
    </g>
  );
}

/**
 * The bowl standing on a baseline at `base`, centred on x. `w` is the half width at the base
 * (30 on the landing scale, 10 on the card); the rim and food follow the reference proportions.
 */
export function Bowl({ x, base, size = "large" }: { x: number; base: number; size?: "large" | "small" }) {
  if (size === "small") {
    return <path d={`M${(x - 10).toFixed(1)} ${base} L${(x + 10).toFixed(1)} ${base} L${(x + 7).toFixed(1)} ${base - 9} L${(x - 7).toFixed(1)} ${base - 9} Z`} fill={C.signal} />;
  }
  return (
    <>
      <path d={`M${(x - 30).toFixed(1)} ${base} L${(x + 30).toFixed(1)} ${base} L${(x + 22).toFixed(1)} ${base - 24} L${(x - 22).toFixed(1)} ${base - 24} Z`} fill={C.signal} />
      <path d={`M${(x - 18).toFixed(1)} ${base - 24} Q${x.toFixed(1)} ${base - 42} ${(x + 18).toFixed(1)} ${base - 24} Z`} fill={C.ink} />
    </>
  );
}

/** Two ears standing on the top edge of an ink block (closing block, card header). */
export function Ears({ viewBox, points }: { viewBox: string; points: [string, string] }) {
  return (
    <svg viewBox={viewBox} style={{ width: "100%", height: "auto", display: "block" }} aria-hidden="true">
      <polygon points={points[0]} fill={C.ink} />
      <polygon points={points[1]} fill={C.ink} />
    </svg>
  );
}

/** The closing block's eyes and whiskers. */
export function EyesLarge() {
  return (
    <svg viewBox="0 0 520 150" style={{ width: "min(520px, 100%)", height: "auto", display: "block", alignSelf: "center" }} aria-hidden="true">
      <ellipse cx="130" cy="60" rx="78" ry="46" fill={C.signal} />
      <ellipse cx="130" cy="60" rx="11" ry="42" fill={C.ink} />
      <ellipse cx="390" cy="60" rx="78" ry="46" fill={C.signal} />
      <ellipse cx="390" cy="60" rx="11" ry="42" fill={C.ink} />
      <polygon points="244,122 276,122 260,140" fill={C.page} />
      <line x1="214" y1="130" x2="110" y2="122" stroke={C.page} strokeWidth="2" />
      <line x1="214" y1="138" x2="112" y2="146" stroke={C.page} strokeWidth="2" />
      <line x1="306" y1="130" x2="410" y2="122" stroke={C.page} strokeWidth="2" />
      <line x1="306" y1="138" x2="408" y2="146" stroke={C.page} strokeWidth="2" />
    </svg>
  );
}

/** The small eyes on the recipient card's header. */
export function EyesSmall() {
  return (
    <svg width="84" height="30" viewBox="0 0 84 30" aria-hidden="true">
      <ellipse cx="20" cy="15" rx="18" ry="11" fill={C.signal} />
      <ellipse cx="20" cy="15" rx="2.8" ry="10" fill={C.ink} />
      <ellipse cx="64" cy="15" rx="18" ry="11" fill={C.signal} />
      <ellipse cx="64" cy="15" rx="2.8" ry="10" fill={C.ink} />
    </svg>
  );
}
