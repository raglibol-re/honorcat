import { C, F } from "@/components/cat/tokens";
import { LiveView } from "./LiveView";

export const metadata = { title: "Live" };

export default function LivePage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>Live</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body, maxWidth: 640 }}>
          QuickNode Streams pushes every new Arc block to HonorCat. Each delivery wakes the relay, so pots settle without anyone watching the chain or
          keeping a page open.
        </p>
      </div>
      <LiveView />
    </div>
  );
}
