import { geminiEventUrl } from "@/lib/geminiLink";
import { C } from "./tokens";

/** A plain link to the market's page on Gemini, opening in a new tab. Renders nothing without a slug. */
export function GeminiLink({ slug, label = "Open on Gemini", size = 14 }: { slug: string | null | undefined; label?: string; size?: number }) {
  const url = geminiEventUrl(slug);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: size, color: C.ink, textDecoration: "underline", textUnderlineOffset: 2, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
      {label}
      <span className="hc-sr"> (opens Gemini in a new tab)</span>
    </a>
  );
}
