"use client";

import { GatewayPanel } from "@/components/pot/GatewayPanel";
import { AccountLine, SignIn, useActor } from "@/components/pot/Who";

/** The pot account and Circle Gateway funding, above the retired products' view. */
export function AccountGateway() {
  const who = useActor();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {who.actor ? <AccountLine who={who} /> : <SignIn who={who} purpose="Sign in to see your HonorCat account and add USDC to it." />}
      <GatewayPanel who={who} />
    </div>
  );
}
