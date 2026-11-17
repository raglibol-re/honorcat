/**
 * Gemini's own page for a prediction-market event (checked: https://www.gemini.com/predictions/<slug>
 * shows that event; the slug comes from Gemini's events API).
 */
export const geminiEventUrl = (slug: string | null | undefined) => (slug && /^[a-z0-9-]+$/.test(slug) ? `https://www.gemini.com/predictions/${slug}` : null);
