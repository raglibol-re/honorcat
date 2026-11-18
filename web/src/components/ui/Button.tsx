"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export type ButtonVariant = "primary" | "quiet" | "danger";
type Common = { variant?: ButtonVariant; size?: "md" | "sm"; block?: boolean; className?: string; children: React.ReactNode };

const cls = (o: Common & { chosen?: boolean }) =>
  ["hc-btn", o.variant === "quiet" && "hc-btn--quiet", o.variant === "danger" && "hc-btn--danger", o.chosen && "hc-btn--chosen", o.size === "sm" && "hc-btn--sm", o.block && "hc-btn--block", o.className].filter(Boolean).join(" ");

/** The walking-paw loader shown inside a busy button. */
export function Paws() {
  return (
    <span className="hc-paws" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * HonorCat's one button. `busy` shows the paw loader beside the label (the label stays, so the
 * button never jumps) and marks it busy for screen readers; pass the step text to
 * `ActionProgress` under it. Disabled while busy.
 */
export function Button({
  variant = "primary",
  size = "md",
  block,
  busy,
  chosen,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: Common & { busy?: boolean; chosen?: boolean } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className" | "children">) {
  return (
    <button type={type} className={cls({ variant, size, block, chosen, className, children })} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      <span className="hc-btn__label">{children}</span>
      {busy && <Paws />}
    </button>
  );
}

/** A link that looks like a button (same variants), for navigation. */
export function ButtonLink({ href, variant = "primary", size = "md", block, className, children, ...rest }: Common & { href: string } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "className" | "children">) {
  const external = /^https?:/.test(href);
  if (external)
    return (
      <a href={href} className={cls({ variant, size, block, className, children })} target="_blank" rel="noreferrer" {...rest}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls({ variant, size, block, className, children })} {...rest}>
      {children}
    </Link>
  );
}

/** Seconds since `active` became true (0 while idle). */
function useElapsed(active: boolean) {
  const [s, setS] = useState(0);
  useEffect(() => {
    if (!active) return;
    const start = Date.now();
    const t = setInterval(() => setS(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => {
      clearInterval(t);
      setS(0);
    };
  }, [active]);
  return s;
}

/**
 * The line under a busy button: "Step 2 of 3 · Confirm with your passkey" and the seconds waited.
 * Takes the step strings the actions already report ("Confirm with your passkey (1 of 2): …").
 */
export function ActionProgress({ step }: { step: string | null | undefined }) {
  const elapsed = useElapsed(!!step);
  if (!step) return null;
  const m = step.match(/^(.*?)\s*\((\d+) of (\d+)\):\s*(.*)$/);
  const head = m ? `Step ${m[2]} of ${m[3]}` : null;
  const text = m ? `${m[1]}: ${m[4]}` : step;
  return (
    <span className="hc-progress" role="status" aria-live="polite">
      {head && <b>{head}</b>}
      <span>{text}</span>
      {elapsed >= 3 && <span className="hc-progress__t">{elapsed} s</span>}
    </span>
  );
}
