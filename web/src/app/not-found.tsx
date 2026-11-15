import Link from "next/link";
import SiteLayout from "./(site)/layout";

export default function NotFound() {
  return (
    <SiteLayout>
    <div className="mx-auto max-w-[520px] space-y-4 py-10">
      <h1 className="t-27 font-semibold">This page does not exist</h1>
      <p className="t-15" style={{ color: "var(--vg-muted)" }}>
        The link may be mistyped, or the guarantee or payout list was never created.
      </p>
      <Link href="/guarantees" className="t-15 inline-block underline underline-offset-4">
        See the guarantees that are live
      </Link>
    </div>
    </SiteLayout>
  );
}
