import { C, F } from "@/components/cat/tokens";
import { StatusView } from "./StatusView";

export const metadata = { title: { absolute: "Relay status · Verdict" } };

export default function StatusPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Relay status</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 640 }}>
          The relay signs outcomes and sends transactions. On Arc it pays gas in USDC, so costs and runway are in USDC.
        </p>
      </div>
      <StatusView />
    </div>
  );
}
