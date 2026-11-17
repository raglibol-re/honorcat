import { Suspense } from "react";
import { PotView } from "./PotView";

/** Each pot's own title ("Pot 28"), so tabs, history and the screen-reader route announcement name it. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: /^\d{1,12}$/.test(id) ? `Pot ${id}` : "Pot" };
}

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
