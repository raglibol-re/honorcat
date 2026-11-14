import { createHash, webcrypto } from "node:crypto";
import { toHex, type Hex } from "viem";
import type { WebAuthnAssertion } from "./passkeys";

/**
 * A software WebAuthn authenticator for tests and the end-to-end script: a P-256 key in memory
 * that produces assertions byte-for-byte shaped like a browser's (authenticatorData = rpIdHash |
 * flags | signCount, clientDataJSON with type/challenge/origin, low-s signature). Not for
 * production use; real users sign with their device's passkey.
 */
const N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

export async function softPasskey(rpId: string, opts: { flags?: number; highS?: boolean } = {}) {
  const kp = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await webcrypto.subtle.exportKey("jwk", kp.publicKey);
  const qx = toHex(Buffer.from(jwk.x!, "base64url"));
  const qy = toHex(Buffer.from(jwk.y!, "base64url"));
  const credentialId = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  let counter = 0;

  async function sign(challenge: Hex, override: { flags?: number; type?: string; origin?: string } = {}): Promise<WebAuthnAssertion> {
    const rpIdHash = createHash("sha256").update(rpId).digest();
    const flags = override.flags ?? opts.flags ?? 0x05; // UP | UV
    const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), Buffer.from([0, 0, 0, ++counter])]);
    const type = override.type ?? "webauthn.get";
    const clientDataJSON = JSON.stringify({
      type,
      challenge: Buffer.from(challenge.slice(2), "hex").toString("base64url"),
      origin: override.origin ?? `https://${rpId}`,
      crossOrigin: false,
    });
    const signed = Buffer.concat([authData, createHash("sha256").update(clientDataJSON).digest()]);
    const sig = new Uint8Array(await webcrypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
    const r = BigInt(toHex(sig.slice(0, 32)));
    let s = BigInt(toHex(sig.slice(32)));
    if (s > N / 2n !== Boolean(opts.highS)) s = N - s; // low-s unless a test wants high-s
    return {
      authenticatorData: toHex(authData),
      clientDataJSON,
      typeIndex: clientDataJSON.indexOf('"type":"'),
      challengeIndex: clientDataJSON.indexOf('"challenge":"'),
      r: toHex(r, { size: 32 }),
      s: toHex(s, { size: 32 }),
    };
  }

  return { qx, qy, credentialId, rpId, sign };
}
