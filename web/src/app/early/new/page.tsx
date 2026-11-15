import { NewEarly } from "./NewEarly";

export const metadata = { title: "Pay before it happens" };

export default function NewEarlyPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="t-27 font-semibold">Pay people before it happens</h1>
        <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
          Pick any live Gemini market. Set money aside for a list of people; everyone is paid at once when the market considers the event
          very likely, so they can prepare. Afterwards the page records whether the market was right.
        </p>
      </div>
      <NewEarly />
    </div>
  );
}
