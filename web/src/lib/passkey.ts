"use client";

import type { Address, Hex } from "viem";
import { getJson } from "./api";

/**
 * Passkey accounts in the browser (WebAuthn, P-256 / ES256). The passkey is bound to this site
 * (RP ID = hostname); its public key determines the customer's on-chain account address, which
 * receives refunds before it is ever deployed. Every action is a WebAuthn assertion over a
 * challenge the server derives exactly as the PasskeyAccount contract does.
 */
const STORAGE_KEY = "honorcat.passkey.v1";
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export type PasskeySession = { credentialId: string; account: Address };
export type Assertion = { authenticatorData: Hex; clientDataJSON: string; challengeIndex: number; typeIndex: number; r: Hex; s: Hex };

export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function";

const toHex = (b: ArrayBuffer | Uint8Array): Hex =>
  `0x${[...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const fromHex = (h: Hex) => Uint8Array.from(h.slice(2).match(/../g)!.map((x) => parseInt(x, 16)));
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export function savedPasskey(): PasskeySession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PasskeySession) : null;
  } catch {
    return null;
  }
}
function save(s: PasskeySession) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* private mode: session lasts for this tab */
  }
}
export function forgetPasskey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Creates a passkey for HonorCat and registers its public key; returns the account address. */
export async function createPasskey(): Promise<PasskeySession> {
  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge: random(32),
      rp: { name: "HonorCat", id: location.hostname },
      user: { id: random(16), name: "HonorCat customer", displayName: "HonorCat customer" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], // ES256 = P-256
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      attestation: "none",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation was cancelled");
  const response = cred.response as AuthenticatorAttestationResponse;
  if (response.getPublicKeyAlgorithm?.() !== -7) throw new Error("This passkey does not use P-256; please try another authenticator");
  const spki = response.getPublicKey?.();
  if (!spki) throw new Error("This browser does not expose the passkey's public key");
  const point = new Uint8Array(spki).slice(-64); // SPKI ends with the uncompressed point 04||x||y
  const reg = await getJson<{ account: Address; credentialId: string }>("/api/passkeys/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credentialId: b64url(cred.rawId), qx: toHex(point.slice(0, 32)), qy: toHex(point.slice(32)) }),
  });
  const session = { credentialId: reg.credentialId, account: reg.account };
  save(session);
  return session;
}

/** Signs in with an existing passkey (also one synced from another device). */
export async function signInWithPasskey(): Promise<PasskeySession> {
  const cred = (await navigator.credentials.get({
    publicKey: { challenge: random(32), rpId: location.hostname, userVerification: "required", timeout: 120_000 },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Sign-in was cancelled");
  const id = b64url(cred.rawId);
  const rec = await getJson<{ account: Address; credentialId: string }>(`/api/passkeys/${id}`);
  const session = { credentialId: rec.credentialId, account: rec.account };
  save(session);
  return session;
}

/** DER ECDSA signature -> (r, s), with s normalised to the low half as the contract requires. */
function derToRs(der: Uint8Array): { r: Hex; s: Hex } {
  let i = 2; // 0x30 len
  if (der[1]! & 0x80) i += der[1]! & 0x7f;
  const read = () => {
    if (der[i] !== 0x02) throw new Error("bad DER signature");
    const len = der[i + 1]!;
    const v = der.slice(i + 2, i + 2 + len);
    i += 2 + len;
    return BigInt(toHex(v));
  };
  const r = read();
  let s = read();
  if (s > N / 2n) s = N - s;
  const pad = (x: bigint) => `0x${x.toString(16).padStart(64, "0")}` as Hex;
  return { r: pad(r), s: pad(s) };
}

/** Asks the passkey to sign a 32-byte challenge (hex). */
export async function signChallenge(session: PasskeySession, challenge: Hex): Promise<Assertion> {
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: fromHex(challenge),
      rpId: location.hostname,
      allowCredentials: [{ type: "public-key", id: fromB64url(session.credentialId) }],
      userVerification: "required",
      timeout: 120_000,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Signing was cancelled");
  const res = cred.response as AuthenticatorAssertionResponse;
  const clientDataJSON = new TextDecoder().decode(res.clientDataJSON);
  return {
    authenticatorData: toHex(res.authenticatorData),
    clientDataJSON,
    typeIndex: clientDataJSON.indexOf('"type":"'),
    challengeIndex: clientDataJSON.indexOf('"challenge":"'),
    ...derToRs(new Uint8Array(res.signature)),
  };
}

/** keccak256 of the join message, computed in the browser with viem. */
export async function joinChallenge(message: string): Promise<Hex> {
  const { keccak256, stringToBytes } = await import("viem");
  return keccak256(stringToBytes(message));
}
