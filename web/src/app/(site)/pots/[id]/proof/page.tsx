import { Suspense } from "react";
import { Proof } from "./Proof";

export const metadata = { title: "Proof of a pot" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Proof id={id} />;
}

export default function ProofPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
