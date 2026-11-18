import { CatHead } from "@/components/cat/shapes";
import { C } from "@/components/cat/tokens";

/**
 * Lives as small cat heads (the one symbol for lives everywhere; paw prints are only the market's
 * trail). Filled heads are lives left; outlined heads, lives lost. Above `max` heads, a number.
 */
export function Lives({ left, lost = 0, size = 18, max = 12, label }: { left: number; lost?: number; size?: number; max?: number; label?: string }) {
  const words = label ?? `${left} ${left === 1 ? "life" : "lives"} left${lost ? `, ${lost} lost` : ""}`;
  const showLeft = Math.min(left, max);
  const showLost = Math.min(lost, Math.max(0, max - showLeft));
  return (
    <span role="img" aria-label={words} title={words} style={{ display: "inline-flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
      {Array.from({ length: showLeft }, (_, i) => (
        <CatHead key={`l${i}`} width={size} height={size} fill={C.ink} eyes={C.page} />
      ))}
      {Array.from({ length: showLost }, (_, i) => (
        <CatHead key={`x${i}`} width={size} height={size} fill={C.dash} outline />
      ))}
      {left > max && <span style={{ fontSize: size * 0.8, marginLeft: 4 }}>{left}</span>}
    </span>
  );
}
