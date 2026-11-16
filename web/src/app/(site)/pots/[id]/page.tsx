import { Suspense } from "react";
import { PotView } from "./PotView";

export const metadata = { title: "Pot" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PotView id={id} />;
}

export default function PotPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
