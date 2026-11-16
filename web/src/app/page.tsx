import { connection } from "next/server";
import { Suspense } from "react";
import { homeData } from "@/server/home";
import { Home } from "./Home";

export default function HomePage() {
  return (
    <Suspense fallback={<Home data={{ potId: null, market: null }} />}>
      <WithData />
    </Suspense>
  );
}

async function WithData() {
  await connection();
  const data = await homeData().catch(() => ({ potId: null, market: null }));
  return <Home data={data} />;
}
