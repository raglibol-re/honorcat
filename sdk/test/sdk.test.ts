import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { conditionIdFor, parseWebhook, Verdict, VerdictError, verifyWebhook } from "../src/index";

const sign = (secret: string, t: number, body: string) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;

describe("webhooks", () => {
  it("accepts signatures made the way the relay makes them", async () => {
    const body = JSON.stringify({ id: "0xabc:1", type: "pot.resolved" });
    const t = 1_800_000_000;
    expect(await verifyWebhook("whsec_x", sign("whsec_x", t, body), body, { now: t + 10 })).toBe(true);
    expect(await verifyWebhook("whsec_y", sign("whsec_x", t, body), body, { now: t + 10 })).toBe(false);
    expect(await verifyWebhook("whsec_x", sign("whsec_x", t, body), body + " ", { now: t + 10 })).toBe(false);
    expect(await verifyWebhook("whsec_x", sign("whsec_x", t, body), body, { now: t + 1000 })).toBe(false);
    expect(await verifyWebhook("whsec_x", undefined, body)).toBe(false);
  });

  it("parseWebhook returns the event or throws", async () => {
    const body = '{"type":"ping"}';
    const now = Math.floor(Date.now() / 1000);
    expect((await parseWebhook("s", sign("s", now, body), body)).type).toBe("ping");
    await expect(parseWebhook("s", sign("t", now, body), body)).rejects.toThrow();
  });
});

describe("client", () => {
  it("derives condition ids like the relay", () => {
    expect(conditionIdFor("api", "order-1")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(conditionIdFor("api", "order-1")).not.toBe(conditionIdFor("manual", "order-1"));
  });

  it("signs the prepared authorization and submits it (gasless create)", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const calls: { url: string; body: unknown; auth: string | null }[] = [];
    const typedData = {
      domain: { name: "USDC", version: "2", chainId: 5042002, verifyingContract: "0x3600000000000000000000000000000000000000" },
      types: {
        ReceiveWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "ReceiveWithAuthorization",
      message: {
        from: signer.address,
        to: "0x1111111111111111111111111111111111111111",
        value: "1000000",
        validAfter: "0",
        validBefore: "9999999999",
        nonce: `0x${"11".repeat(32)}`,
      },
    };
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, body, auth: (init.headers as Record<string, string>).authorization ?? null });
      if (url.endsWith("/api/health")) return Response.json({ resolver: "0x2222222222222222222222222222222222222222" });
      if (url.endsWith("/api/gasless/prepare")) return Response.json({ salt: `0x${"22".repeat(32)}`, nonce: typedData.message.nonce, validAfter: "0", validBefore: "9999999999", typedData });
      if (url.endsWith("/api/gasless/create")) return Response.json({ tx: "0xdead", potId: "7" });
      return new Response(JSON.stringify({ error: "nope" }), { status: 404 });
    }) as unknown as typeof fetch;

    const v = new Verdict({ baseUrl: "https://v.example/", apiKey: "vk_x", fetch: fetchImpl });
    const res = await v.createPotGasless({
      signer,
      amount: 1_000_000n,
      params: {
        conditionId: conditionIdFor("api", "o"),
        payees: ["0x3333333333333333333333333333333333333333"],
        sharesBps: [10000],
        refundTo: signer.address,
        deadline: 2_000_000_000,
      },
    });
    expect(res).toEqual({ tx: "0xdead", potId: "7" });
    const submitted = calls.find((c) => c.url.endsWith("/create"))!.body as { authorization: { signature: Hex; from: string }; params: { resolver: string; deadline: string } };
    expect(submitted.params.resolver).toBe("0x2222222222222222222222222222222222222222");
    expect(submitted.params.deadline).toBe("2000000000");
    const recovered = await recoverTypedDataAddress(({
      ...(typedData as unknown as Record<string, unknown>),
      message: { ...typedData.message, value: 1_000_000n, validAfter: 0n, validBefore: 9_999_999_999n },
      signature: submitted.authorization.signature,
    }) as never);
    expect(recovered).toBe(signer.address);
    expect(calls.every((c) => c.auth === "Bearer vk_x")).toBe(true);

    await expect(v.getPot(99)).rejects.toBeInstanceOf(VerdictError);
  });
});
