import { LiveView } from "./LiveView";

export const metadata = { title: "Live · Verdict" };

export default function LivePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Live: how chain events reach Verdict</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          QuickNode Streams watches every new Arc block, runs our filter on QuickNode&apos;s side, and pushes the result to
          Verdict&apos;s webhook. Each delivery is checked, indexed and wakes the relay, so pots settle without anyone polling
          the chain or keeping a page open.
        </p>
      </div>
      <LiveView />
    </div>
  );
}
