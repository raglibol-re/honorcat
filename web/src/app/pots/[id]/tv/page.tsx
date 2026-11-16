import { Suspense } from "react";
import { TvView } from "./TvView";

export const metadata = { title: "Pot on the big screen" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TvView id={id} />;
}

export default function TvPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
