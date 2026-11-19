"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { concat, encodeAbiParameters, getAddress, isAddress, keccak256, type Address, type Hex } from "viem";
import { C, F } from "@/components/cat/tokens";
import { Bell } from "@/components/honor/Honor";
import { useActor } from "@/components/pot/Who";
import { Button } from "@/components/ui/Button";
import { getJson } from "@/lib/api";
import { addressUrl, publicClient, RPC_URL, txUrl } from "@/lib/chain";

type Proof = { day: number; version: number; root: Hex; lastBlock: number; account: string; total: string; proof: Hex[] | null; tx: string | null; contract: Address | null };

const rootsAbi = [
  {
    type: "function",
    name: "roots",
    stateMutability: "view",
    inputs: [{ name: "day", type: "uint32" }],
    outputs: [
      { name: "root", type: "bytes32" },
      { name: "version", type: "uint32" },
      { name: "lastBlock", type: "uint64" },
      { name: "postedAt", type: "uint64" },
    ],
  },
  {
    type: "function",
    name: "verify",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "total", type: "uint256" },
      { name: "day", type: "uint32" },
      { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** The contract's leaf: keccak256(bytes.concat(keccak256(abi.encode(account, total, version, day)))). */
const leafOf = (a: Address, total: bigint, version: number, day: number) =>
  keccak256(keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint32" }, { type: "uint32" }], [a, total, version, day])));
/** OpenZeppelin MerkleProof: fold the proof with sorted pairs. */
const fold = (leaf: Hex, proof: Hex[]) => proof.reduce((h, p) => (h.toLowerCase() < p.toLowerCase() ? keccak256(concat([h, p])) : keccak256(concat([p, h]))), leaf);

type Check = { label: string; ok: boolean | null; detail: string };

/**
 * Checks a player's honor in this browser: the proof comes from our server, but the leaf and the
 * root it leads to are computed here, and the root is read from HonorRoots on Arc directly
 * (public RPC), then the contract's own verify() is asked too. Nothing has to be trusted.
 */
export function Verify() {
  const who = useActor();
  const [acc, setAcc] = useState("");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [p, setP] = useState<Proof | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("account");
    const start = q ?? who.actor?.account ?? "";
    if (start) void Promise.resolve().then(() => setAcc((a) => a || start));
  }, [who.actor?.account]);

  async function run() {
    if (!isAddress(acc)) return;
    setBusy(true);
    setChecks(null);
    try {
      const proof = await getJson<Proof>(`/api/hc/honor/proof?account=${acc}`);
      setP(proof);
      const out: Check[] = [];
      if (!proof.proof) {
        out.push({ label: "In the day's tree", ok: false, detail: `No honor for this account on day ${proof.day}.` });
        setChecks(out);
        return;
      }
      const leaf = leafOf(getAddress(acc), BigInt(proof.total), proof.version, proof.day);
      const computed = fold(leaf, proof.proof);
      out.push({ label: "Root computed in this browser", ok: computed.toLowerCase() === proof.root.toLowerCase(), detail: computed });
      if (!proof.contract) {
        out.push({ label: "Root on Arc", ok: null, detail: "HonorRoots is not deployed yet: the root cannot be read on Arc." });
      } else {
        const [onchain] = (await publicClient.readContract({ address: proof.contract, abi: rootsAbi, functionName: "roots", args: [proof.day] })) as readonly [Hex, number, bigint, bigint];
        out.push({ label: `Root on Arc for day ${proof.day}`, ok: onchain.toLowerCase() === computed.toLowerCase(), detail: `${onchain} (read from ${RPC_URL})` });
        const ok = (await publicClient.readContract({ address: proof.contract, abi: rootsAbi, functionName: "verify", args: [getAddress(acc), BigInt(proof.total), proof.day, proof.proof] })) as boolean;
        out.push({ label: "HonorRoots.verify() on Arc", ok, detail: ok ? "the contract accepts the proof" : "the contract refuses the proof" });
      }
      setChecks(out);
    } catch (e) {
      setChecks([{ label: "Proof", ok: false, detail: /404/.test(String(e)) ? "No honor root yet." : String((e as Error).message ?? e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 820 }}>
      <h1 style={{ margin: 0, fontFamily: F.cond, fontSize: "clamp(40px, 8vw, 56px)", fontWeight: 600, display: "flex", gap: 12, alignItems: "center" }}>
        <Bell size={40} /> Verify honor on Arc
      </h1>
      <p style={{ margin: 0, fontSize: 17, lineHeight: 1.55, color: C.body }}>
        Every day the relay posts one Merkle root of all honor balances to HonorRoots on Arc; a posted root can never be changed. This page takes a
        player&apos;s proof from our server, computes the leaf and the root in your browser, reads the root on Arc itself, and asks the contract. <Link href="/honor">How honor is counted</Link>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
      >
        <label className="hc-field" style={{ flex: "1 1 360px" }}>
          <span className="hc-field__label">Account</span>
          <input className="hc-input" value={acc} onChange={(e) => setAcc(e.target.value.trim())} placeholder="0x…" style={{ fontFamily: F.mono, fontSize: 15 }} />
        </label>
        <Button type="submit" busy={busy} disabled={!isAddress(acc) || busy}>
          Check
        </Button>
      </form>
      {p && (
        <p style={{ margin: 0, fontSize: 15, color: C.body }}>
          Day {p.day} (rules version {p.version}, counted up to block {p.lastBlock}): {(Number(p.total) / 100).toFixed(1)} honor.
          {p.contract && (
            <>
              {" "}
              <a href={addressUrl(p.contract)} target="_blank" rel="noreferrer">
                HonorRoots
              </a>
            </>
          )}
          {p.tx && (
            <>
              {" · "}
              <a href={txUrl(p.tx)} target="_blank" rel="noreferrer">
                the root&apos;s transaction
              </a>
            </>
          )}
        </p>
      )}
      {checks && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", borderTop: `1.5px solid ${C.ink}` }}>
          {checks.map((c) => (
            <li key={c.label} style={{ display: "flex", gap: 12, padding: "10px 2px", borderBottom: `1px solid ${C.faint}`, fontSize: 15, flexWrap: "wrap" }}>
              <strong style={{ minWidth: 70, color: c.ok === false ? C.signalInk : C.ink }}>{c.ok === null ? "Waiting" : c.ok ? "Yes" : "No"}</strong>
              <span style={{ flex: "1 1 300px" }}>
                {c.label}
                <span style={{ display: "block", fontFamily: F.mono, fontSize: 12, color: C.muted, wordBreak: "break-all" }}>{c.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
