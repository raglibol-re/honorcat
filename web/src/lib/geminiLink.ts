/**
 * Gemini's own page for a prediction-market event: https://www.gemini.com/predictions/<EVENT_TICKER>/<slug>
 * (as Gemini links its events, e.g. /predictions/BRPRES2026/brazil-presidential-election-winner-2026).
 * The event ticker is what identifies the event: slugs repeat (the 5- and 15-minute BTC events share
 * one), and a slug alone redirects to Gemini's home page. Both come from Gemini's events API.
 */
export const geminiEventUrl = (ticker: string | null | undefined, slug?: string | null) => {
  if (!ticker || !/^[A-Za-z0-9-]+$/.test(ticker)) return null;
  const s = slug && /^[a-z0-9-]+$/.test(slug) ? `/${slug}` : "";
  return `https://www.gemini.com/predictions/${encodeURIComponent(ticker)}${s}`;
};
