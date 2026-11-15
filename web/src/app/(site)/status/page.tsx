import { StatusView } from "./StatusView";

export const metadata = { title: { absolute: "Relay status · Verdict" } };

export default function StatusPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Relay status</h1>
        <p className="text-sm text-muted">
          The relay signs outcomes and submits transactions. On Arc it pays gas in USDC, so its costs and runway are shown in USDC.
        </p>
      </div>
      <StatusView />
    </div>
  );
}
