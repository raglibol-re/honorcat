import { Suspense } from "react";
import { Together } from "./Together";

export const metadata = { title: "A pot for two" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Together id={id} />;
}

export default function TogetherPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
