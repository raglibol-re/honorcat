import { F } from "@/components/cat/tokens";
import { AccountView } from "./AccountView";

export const metadata = { title: "My money" };

export default function AccountPage() {
  return (
    <div style={{ maxWidth: 520, display: "flex", flexDirection: "column", gap: 28 }}>
      <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: 64, fontWeight: 600, lineHeight: 0.95 }}>My money</h1>
      <AccountView />
    </div>
  );
}
