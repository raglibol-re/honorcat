import { Suspense } from "react";
import { GroupView } from "./GroupView";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: /^\d{1,12}$/.test(id) ? `Group ${id}` : "Group" };
}

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GroupView id={id} />;
}

export default function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
