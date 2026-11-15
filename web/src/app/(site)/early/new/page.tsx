import { NewEarly } from "./NewEarly";

export const metadata = { title: "Pay before it happens" };

export default function NewEarlyPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <h1 className="t-27 font-semibold">Pay people before it happens</h1>
      </div>
      <NewEarly />
    </div>
  );
}
