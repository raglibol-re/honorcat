"use client";

import { tagName } from "@/lib/nickname";

import { FURS, furOf, wearOf, type Fur } from "@/lib/names";
import { Cat, type CatPose, type Mood } from "./Cat";

/** A fur key as the Cat component takes it. */
export const furProps = (f: Fur) => FURS[f];

/** A player's own cat (their picked fur, or a stable one from their address). */
export function PlayerCat({ account, fur, pose = "sit", size = 80, mood, label }: { account?: string | null; fur?: Fur; pose?: CatPose; size?: number; mood?: Mood; label?: string }) {
  return <Cat pose={pose} size={size} mood={mood} label={label} fur={FURS[fur ?? furOf(account)]} wear={wearOf(account)} />;
}

/** A player's name with their cat's face in front: how a player appears in lists and records. */
export function CatName({ account, name, size = 22, strong = false }: { account: string | null | undefined; name: string; size?: number; strong?: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, verticalAlign: "middle" }}>
      <span aria-hidden="true" style={{ display: "inline-block", width: size, flex: "none" }}>
        <PlayerCat account={account} pose="face" size={size} label="" />
      </span>
      {strong ? <strong>{tagName(name, account)}</strong> : <span>{tagName(name, account)}</span>}
    </span>
  );
}
