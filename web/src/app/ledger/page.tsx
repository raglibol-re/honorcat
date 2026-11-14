import { Ledger } from "./Ledger";

export const metadata = { title: "Ledger" };

export default function LedgerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ledger</h1>
        <p className="text-sm text-muted">Every refund and payment of the guarantees on this deployment, as indexed from the chain.</p>
      </div>
      <Ledger />
    </div>
  );
}
