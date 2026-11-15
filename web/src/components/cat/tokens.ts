/**
 * HonorCat design tokens, copied from docs/design/landing.html and recipient-card.html.
 * Do not round or substitute: these are the reference values.
 */
export const C = {
  page: "#ECEAE4", // background
  ink: "#111111", // text, cat, rules
  body: "#33312D", // body copy
  muted: "#55534E", // secondary text
  faint: "#C9C6BE", // text on ink, row rules
  onInk: "#DEDBD3", // sub copy on ink
  grid: "#DDDAD2", // chart grid
  panel: "#F6F4EE", // chart panel
  dash: "#8A877F", // dashed connector
  signal: "#E8421A", // the one signal colour
  signalInk: "#B8320F", // signal text, hover
} as const;

/** Families: Barlow 400/500/600, Barlow Condensed 500/600/700, IBM Plex Mono 400/500 (next/font variables). */
export const F = {
  sans: "var(--font-barlow), 'Helvetica Neue', Arial, sans-serif",
  cond: "var(--font-barlow-condensed), 'Arial Narrow', sans-serif",
  mono: "var(--font-plex-mono), ui-monospace, monospace",
} as const;
