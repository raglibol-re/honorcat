import { ImageResponse } from "next/og";
import { connection } from "next/server";
import { getDb, pots } from "@/server/relay";
import { sidesOf } from "@/lib/statement";

/**
 * The preview image of a pot link (invitations): the question, the rope between two posts with the
 * cat at the last measured price, and what each side holds. Plain amounts; test money noted.
 */
export const alt = "An HonorCat pot: the question and the rope with the cat at the price";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#111111";
const PAGE = "#ECEAE4";
const SIGNAL = "#E8421A";
const MUTED = "#55534E";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  let question = "An HonorCat pot";
  let other = "";
  let price: number | null = null;
  let pot = 0;
  let state = "";
  try {
    const d = /^\d+$/.test(id) ? await pots.potDetail(await getDb(), id) : null;
    if (d) {
      const m = d.market as { eventTitle: string; label: string; teams?: string | null } | null;
      if (m) {
        const st = sidesOf(m);
        question = `${st.yes}?`;
        other = st.no;
      }
      const data = d.data as { notional: string; bandCenter: string; initialNotional?: string };
      pot = Number(data.notional === "0" ? (data.initialNotional ?? "0") : data.notional) / 1e6;
      const last = (d.requests as { payload: { attestation?: { valid: boolean; priceYes: number } } }[]).find((r) => r.payload.attestation?.valid);
      price = last?.payload.attestation ? last.payload.attestation.priceYes / 1e6 : Number(data.bandCenter) / 1e6 || null;
      state = String(d.state);
    }
  } catch {
    /* the image still shows the brand and the rope */
  }
  const p = price ?? 0.5;
  // The rope: posts at x 80 and 1120, sagging 40 px in the middle; the cat at the price.
  const X0 = 80;
  const SPAN = 1040;
  const TOP = 380;
  const x = X0 + SPAN * p;
  const y = TOP + 160 * p * (1 - p);
  const rope = Array.from({ length: 41 }, (_, i) => {
    const q = i / 40;
    return `${(X0 + SPAN * q).toFixed(1)},${(TOP + 160 * q * (1 - q)).toFixed(1)}`;
  });
  const split = Math.round(40 * p);
  const left = rope.slice(0, split + 1).join(" ");
  const right = rope.slice(split).join(" ");
  const usd = (v: number) => `$${v.toFixed(2)}`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: PAGE, padding: "48px 80px", fontFamily: "sans-serif", color: INK }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700 }}>
          <svg width="44" height="44" viewBox="0 0 20 20">
            <path fill={INK} d="M2 3 L6 7 L14 7 L18 3 L18 13 L15 17 L5 17 L2 13 Z" />
            <ellipse cx="7.4" cy="11" rx="1.4" ry="2.1" fill={SIGNAL} />
            <ellipse cx="12.6" cy="11" rx="1.4" ry="2.1" fill={SIGNAL} />
          </svg>
          <span>HonorCat</span>
          <span style={{ marginLeft: "auto", fontSize: 24, fontWeight: 400, color: MUTED }}>Pot {id} · test money on Arc</span>
        </div>
        <div style={{ display: "flex", fontSize: question.length > 40 ? 58 : 72, fontWeight: 700, lineHeight: 1.05, marginTop: 28 }}>{question}</div>
        {other && <div style={{ display: "flex", fontSize: 28, color: MUTED, marginTop: 8 }}>The other side: {other}</div>}
        <svg width="1040" height="250" viewBox="0 300 1200 250" style={{ position: "absolute", left: 80, top: 300 }}>
          <rect x={X0 - 8} y={TOP - 20} width="16" height="60" fill={INK} />
          <rect x={X0 + SPAN - 8} y={TOP - 20} width="16" height="60" fill={SIGNAL} />
          <polyline points={rope.join(" ")} fill="none" stroke={INK} strokeWidth="14" strokeLinecap="round" />
          <polyline points={left} fill="none" stroke={INK} strokeWidth="8" strokeLinecap="round" />
          <polyline points={right} fill="none" stroke={SIGNAL} strokeWidth="8" strokeLinecap="round" />
          <circle cx={x} cy={y - 40} r="30" fill={INK} />
          <polygon points={`${x - 28},${y - 52} ${x - 22},${y - 92} ${x - 4},${y - 66}`} fill={INK} />
          <polygon points={`${x + 4},${y - 66} ${x + 22},${y - 92} ${x + 28},${y - 52}`} fill={INK} />
          <ellipse cx={x - 10} cy={y - 40} rx="7" ry="9" fill={SIGNAL} />
          <ellipse cx={x + 10} cy={y - 40} rx="7" ry="9" fill={SIGNAL} />
        </svg>
        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 26, color: MUTED }}>{price === null ? "" : `${Math.round(p * 100)}% chance`}</span>
            <span style={{ fontSize: 56, fontWeight: 700 }}>{pot ? usd(pot * p) : ""}</span>
          </div>
          <span style={{ fontSize: 30, fontWeight: 700 }}>{state === "Open" ? "Take the other side" : `Pot ${usd(pot)}`}</span>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
            <span style={{ fontSize: 26, color: MUTED }}>{price === null ? "" : `${100 - Math.round(p * 100)}% the other way`}</span>
            <span style={{ fontSize: 56, fontWeight: 700, color: "#B8320F" }}>{pot ? usd(pot * (1 - p)) : ""}</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
