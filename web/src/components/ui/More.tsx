/**
 * Folds secondary text (rules, explanations, history) away behind one short line, so a page shows
 * what matters first. Native <details>: works without JavaScript and with the keyboard.
 */
export function More({ label, children, open, style }: { label: React.ReactNode; children: React.ReactNode; open?: boolean; style?: React.CSSProperties }) {
  return (
    <details className="hc-more" open={open} style={style}>
      <summary className="hc-more__summary">{label}</summary>
      <div className="hc-more__body">{children}</div>
    </details>
  );
}
