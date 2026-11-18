import { useId } from "react";

/** A labelled field: the label, the control, and either a hint or the problem with this value. */
export function Field({ label, hint, error, children, style }: { label: React.ReactNode; hint?: React.ReactNode; error?: React.ReactNode; children: (id: string, describedBy: string | undefined) => React.ReactNode; style?: React.CSSProperties }) {
  const id = useId();
  const note = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className="hc-field" style={style}>
      <label htmlFor={id} className="hc-field__label">
        {label}
      </label>
      {children(id, note)}
      {error ? (
        <span id={`${id}-err`} className="hc-field__error">
          {error}
        </span>
      ) : hint ? (
        <span id={`${id}-hint`} className="hc-field__hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** HonorCat's text input (use inside `Field`, or alone with an aria-label). */
export function Input({ invalid, className, ...rest }: { invalid?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={["hc-input", className].filter(Boolean).join(" ")} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={["hc-input", className].filter(Boolean).join(" ")} {...rest} />;
}

/** A note beside the content: plain, a warning, an error, or a success. */
export function Notice({ tone = "note", children, role }: { tone?: "note" | "warning" | "error" | "success"; children: React.ReactNode; role?: "alert" | "status" | "note" }) {
  return (
    <div className={`hc-notice hc-notice--${tone}`} role={role ?? (tone === "error" ? "alert" : tone === "success" ? "status" : undefined)}>
      {children}
    </div>
  );
}
