import { InstallPanel } from "@/components/app/InstallApp";
import { C, F } from "@/components/cat/tokens";

export const metadata = { title: "Get the app", description: "Install HonorCat on your phone: free, no app store, opens full screen." };

/** Install HonorCat as an app: one tap where the browser offers it, the steps for this device otherwise. */
export default function AppPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 640 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(44px, 9vw, 64px)", fontWeight: 600, lineHeight: 0.95 }}>Get the app</h1>
        <p style={{ margin: 0, fontSize: 19, lineHeight: 1.45, color: C.body }}>
          HonorCat on your home screen: full screen and one tap away. Sign in there with the same passkey. No app store needed.
        </p>
      </div>
      <InstallPanel />
    </div>
  );
}
