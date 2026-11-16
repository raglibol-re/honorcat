import Link from "next/link";
import { Cat } from "@/components/cat/Cat";

export function NotFoundBody() {
  return (
    <div className="max-w-[640px] space-y-4 py-10">
      <Cat pose="box" size={180} />
      <h1>This page does not exist</h1>
      <p className="t-15" style={{ color: "var(--hc-muted)" }}>
        The link may be mistyped, or the pot was never created.
      </p>
      <Link href="/pots" className="t-15 inline-block underline underline-offset-4">
        See the pots
      </Link>
    </div>
  );
}
