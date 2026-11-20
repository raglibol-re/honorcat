import { C, F } from "@/components/cat/tokens";
import { MarketsView } from "./MarketsView";

export const metadata = { title: "Markets that work today" };

export default function MarketsPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Markets that work today</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 680 }}>
          Live Gemini markets, ranked by spread and depth. A tight spread and a deep book keep a pot&apos;s price steady.
        </p>
      </div>
      <MarketsView />
    </div>
  );
}
