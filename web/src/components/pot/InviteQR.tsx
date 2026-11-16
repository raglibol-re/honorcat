"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { C } from "@/components/cat/tokens";

/**
 * The invitation as a QR code: the other player scans it with a phone camera and lands on the pot
 * (or the friend draft). Drawn as inline SVG in ink on the page colour; the link is shown as text too.
 */
export function InviteQR({ url, size = 180, label = "Scan to open the invitation" }: { url: string; size?: number; label?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: C.ink, light: C.page } })
      .then((s) => alive && setSvg(s))
      .catch(() => alive && setSvg(null));
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <figure style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
      <div role="img" aria-label={`${label}: ${url}`} style={{ width: size, height: size, border: `1.5px solid ${C.ink}` }} dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} />
      <figcaption style={{ fontSize: 14, color: C.muted, overflowWrap: "anywhere", maxWidth: Math.max(size, 260) }}>
        {label}, or open {url}
      </figcaption>
    </figure>
  );
}
