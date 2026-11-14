import { Suspense } from "react";
import { CustomerView } from "./CustomerView";

export const metadata = { title: "Your guarantee" };

export default function GuaranteePage() {
  return (
    <Suspense fallback={<p className="t-15" style={{ color: "var(--vg-muted)" }}>Loading…</p>}>
      <CustomerView />
    </Suspense>
  );
}
