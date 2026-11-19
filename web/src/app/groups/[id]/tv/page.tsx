import { Suspense } from "react";
import { GroupTvView } from "./TvView";

export const metadata = { title: "Group on the big screen" };

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupTvView id={id} />;
}

export default function GroupTvPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
