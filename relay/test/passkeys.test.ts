import { describe, expect, it } from "vitest";
import { keccak256, stringToBytes, type Hex } from "viem";
import { rpIdHashOf, verifyAssertion } from "../src/passkeys";
import { softPasskey } from "../src/softPasskey";

const RP = "verdict-phi-livid.vercel.app";
const challenge = keccak256(stringToBytes("Join HonorCat guarantee abc as 0x1234"));

describe("off-chain WebAuthn verification (mirrors PasskeyAccount)", () => {
  it("accepts a browser-shaped assertion from the right key", async () => {
    const pk = await softPasskey(RP);
    const a = await pk.sign(challenge);
    expect(verifyAssertion(challenge, a, pk.qx, pk.qy, rpIdHashOf(RP))).toBe(true);
  });

  it("rejects a wrong key, a different challenge and another RP", async () => {
    const pk = await softPasskey(RP);
    const other = await softPasskey(RP);
    const a = await pk.sign(challenge);
    expect(verifyAssertion(challenge, a, other.qx, other.qy, rpIdHashOf(RP))).toBe(false);
    expect(verifyAssertion(keccak256(stringToBytes("x")), a, pk.qx, pk.qy, rpIdHashOf(RP))).toBe(false);
    const evil = await softPasskey("evil.example");
    const e = await evil.sign(challenge);
    expect(verifyAssertion(challenge, e, evil.qx, evil.qy, rpIdHashOf(RP))).toBe(false);
  });

  it("rejects missing user verification, registration type, high-s and tampering", async () => {
    const pk = await softPasskey(RP);
    const rp = rpIdHashOf(RP);
    expect(verifyAssertion(challenge, await pk.sign(challenge, { flags: 0x01 }), pk.qx, pk.qy, rp)).toBe(false);
    expect(verifyAssertion(challenge, await pk.sign(challenge, { type: "webauthn.create" }), pk.qx, pk.qy, rp)).toBe(false);
    const hs = await softPasskey(RP, { highS: true });
    expect(verifyAssertion(challenge, await hs.sign(challenge), hs.qx, hs.qy, rp)).toBe(false);
    const a = await pk.sign(challenge);
    expect(verifyAssertion(challenge, { ...a, clientDataJSON: a.clientDataJSON.replace("false", "true ") }, pk.qx, pk.qy, rp)).toBe(false);
    expect(verifyAssertion(challenge, { ...a, challengeIndex: a.challengeIndex + 1 }, pk.qx, pk.qy, rp)).toBe(false);
    expect(verifyAssertion(challenge, { ...a, authenticatorData: "0x00" as Hex }, pk.qx, pk.qy, rp)).toBe(false);
    // backup state without backup eligibility is inconsistent
    expect(verifyAssertion(challenge, await pk.sign(challenge, { flags: 0x15 }), pk.qx, pk.qy, rp)).toBe(false);
  });
});
