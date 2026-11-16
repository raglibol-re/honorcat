import { Suspense } from "react";
import { Record } from "./Record";

export const metadata = { title: "Honor record" };

async function Inner({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  return <Record account={account} />;
}

export default function RecordPage({ params }: { params: Promise<{ account: string }> }) {
  return (
    <Suspense>
      <Inner params={params} />
    </Suspense>
  );
}
