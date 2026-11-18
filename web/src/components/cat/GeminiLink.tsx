import { geminiEventUrl } from "@/lib/geminiLink";
import { C } from "./tokens";

/** A plain link to the market's page on Gemini, opening in a new tab. Renders nothing without the event ticker. */
export function GeminiLink({ ticker, slug, label = "Open on Gemini", size = 14 }: { ticker: string | null | undefined; slug?: string | null; label?: string; size?: number }) {
  const url = geminiEventUrl(ticker, slug);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: size, color: C.ink, textDecoration: "underline", textUnderlineOffset: 2, whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
      {label}
      <span className="hc-sr"> (opens Gemini in a new tab)</span>
    </a>
  );
}
