import { SiteFooter, SiteHeader } from "@/components/SiteChrome";

/** Site chrome for every page except the landing page, which brings its own (docs/design). */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <p className="t-13 px-4 py-2 text-center" style={{ background: "var(--vg-warn-bg)", color: "var(--vg-warn-ink)" }}>
        Test version with test money. Not insurance.
      </p>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:py-10">{children}</main>
      <SiteFooter />
    </>
  );
}
