import { Suspense } from "react";
import { PerpView } from "./PerpView";

/** Each perp's own title ("Perp 3"), so tabs, history and the screen-reader route announcement name it. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: /^\d{1,12}$/.test(id) ? `Perp ${id}` : "Perp" };
}

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PerpView id={id} />;
}

export default function PerpPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
