import { HcFooter, HcHeader } from "@/components/cat/Chrome";

/** Header and closing block from docs/design for every page except the landing page, which has the full closing block. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hc" style={{ minHeight: "100vh", display: "flex", flexDirection: "column", background: "#ECEAE4", color: "#111111" }}>
      <HcHeader />
      <main className="hc-wrap" style={{ width: "100%", flex: 1, paddingTop: 24 }}>
        <div style={{ maxWidth: 1040 }}>{children}</div>
      </main>
      <HcFooter />
    </div>
  );
}
