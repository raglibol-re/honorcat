/**
 * HonorCat mark: a geometric cat head on a flat base (it lands on its feet), one colour,
 * no face. Drawn on a 24-unit grid; inherits `currentColor`.
 */
export const HONORCAT_MARK_PATH =
  "M4.5 21h15a1.5 1.5 0 0 0 1.5-1.5V3.2a.5.5 0 0 0-.82-.38L15.5 7h-7L3.82 2.82A.5.5 0 0 0 3 3.2v16.3A1.5 1.5 0 0 0 4.5 21Z";

export function HonorCatMark({ size = 24, title, className }: { size?: number; title?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={className}
    >
      <path d={HONORCAT_MARK_PATH} />
    </svg>
  );
}

/** Mark + wordmark lockup. */
export function HonorCatLogo({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <HonorCatMark size={size} />
      <span className="font-semibold tracking-tight" style={{ fontSize: size * 0.85 }}>
        HonorCat
      </span>
    </span>
  );
}
