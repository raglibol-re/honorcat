"use client";

import { useState } from "react";
import { C, F } from "@/components/cat/tokens";

/** A value to paste somewhere else, with a copy button. */
export function CopyBlock({ value, multiline = false }: { value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: multiline ? "flex" : "inline-flex", flexDirection: multiline ? "column" : "row", gap: 8, alignItems: multiline ? "stretch" : "center", flexWrap: "wrap", maxWidth: "100%" }}>
      {multiline ? (
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: F.mono, fontSize: 13, lineHeight: 1.5, background: C.panel, border: `1px solid ${C.faint}`, padding: "10px 12px", overflowWrap: "anywhere" }}>{value}</pre>
      ) : (
        <code style={{ fontFamily: F.mono, fontSize: 14, background: C.panel, border: `1px solid ${C.faint}`, padding: "4px 8px", overflowWrap: "anywhere" }}>{value}</code>
      )}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2500);
          } catch {
            /* select and copy by hand */
          }
        }}
        style={{ alignSelf: "flex-start", minHeight: 36, padding: "0 12px", border: `1.5px solid ${C.ink}`, background: "transparent", cursor: "pointer", fontSize: 14, fontWeight: 600 }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
