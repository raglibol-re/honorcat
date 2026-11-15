import { AccountView } from "./AccountView";

export const metadata = { title: "My money" };

export default function AccountPage() {
  return (
    <div className="mx-auto max-w-[520px] space-y-6">
      <div>
        <h1 className="t-27 font-semibold">My money</h1>
      </div>
      <AccountView />
    </div>
  );
}
