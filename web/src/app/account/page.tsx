import { AccountView } from "./AccountView";

export const metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-[520px] space-y-6">
      <div>
        <h1 className="t-27 font-semibold">Your account</h1>
        <p className="t-15 mt-1" style={{ color: "var(--vg-muted)" }}>
          Refunds from HonorCat guarantees arrive here. Sign in with the passkey you joined with.
        </p>
      </div>
      <AccountView />
    </div>
  );
}
