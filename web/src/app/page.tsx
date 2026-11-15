import { connection } from "next/server";
import { Suspense } from "react";
import { landingData } from "@/server/landing";
import { Landing } from "./Landing";

export default function Home() {
  return (
    <Suspense fallback={<Landing initial={null} />}>
      <WithData />
    </Suspense>
  );
}

async function WithData() {
  await connection();
  const initial = await landingData().catch(() => ({ hero: null, payout: null }));
  return <Landing initial={initial} />;
}
