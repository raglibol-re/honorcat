import { Ledger } from "./Ledger";

export const metadata = { title: "Ledger · Verdict" };

export default function LedgerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Ledger</h1>
        <p className="text-sm text-muted">Every payout, refund and claim made by the vault, as indexed from the chain.</p>
      </div>
      <Ledger />
    </div>
  );
}
