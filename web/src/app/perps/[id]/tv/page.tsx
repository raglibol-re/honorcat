import { Suspense } from "react";
import { PerpTvView } from "./TvView";

export const metadata = { title: "Perp on the big screen" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PerpTvView id={id} />;
}

export default function PerpTvPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
