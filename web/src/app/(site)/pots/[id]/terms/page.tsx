import { Suspense } from "react";
import { Terms } from "./Terms";

export const metadata = { title: "Terms of a pot" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Terms id={id} />;
}

export default function TermsPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
