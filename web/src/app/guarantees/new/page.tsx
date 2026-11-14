import { NewGuarantee } from "./NewGuarantee";

export const metadata = { title: "New guarantee · Verdict" };

export default function NewGuaranteePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="t-27 font-semibold">Offer a refund guarantee</h1>
        <p className="t-17 mt-1 max-w-2xl" style={{ color: "var(--vg-muted)" }}>
          Promise your customers their money back if a real-world event happens. You lock the refunds once; customers join without a
          wallet and are paid automatically when the market settles.
        </p>
      </div>
      <NewGuarantee />
    </div>
  );
}
