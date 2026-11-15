import { encodeFunctionData, getAddress, isAddressEqual, type Hex } from "viem";
import { z } from "zod";
import { ARC_DOMAIN, MESSAGE_TRANSMITTER_V2, messageTransmitterAbi, parseHeader, SOURCE_DOMAINS, TOKEN_MESSENGER_V2 } from "@/lib/cctp";
import { errorResponse, getDb, sendRelayCalls } from "@/server/relay";

export const maxDuration = 60;

const hex = z.string().regex(/^0x[0-9a-fA-F]+$/);
const body = z.object({ message: hex, attestation: hex });

/**
 * Finishes a CCTP V2 transfer to Arc: submits Circle's attested message to MessageTransmitterV2,
 * which mints the USDC to the recipient named in the burn. The relay pays the Arc gas, so someone
 * arriving from another chain needs no USDC on Arc first. Only USDC burns from the supported
 * testnets addressed to Arc are accepted; a message already received is reported as done.
 */
export async function POST(req: Request) {
  try {
    const input = body.parse(await req.json().catch(() => null));
    const message = input.message as Hex;
    const h = parseHeader(message);
    if (h.destinationDomain !== ARC_DOMAIN) return Response.json({ error: "not addressed to Arc" }, { status: 400 });
    if (!SOURCE_DOMAINS.includes(h.sourceDomain)) return Response.json({ error: "unsupported source chain" }, { status: 400 });
    if (!isAddressEqual(getAddress(h.recipient), TOKEN_MESSENGER_V2)) return Response.json({ error: "not a USDC transfer" }, { status: 400 });
    if (!/^0x0{64}$/.test(h.destinationCaller)) return Response.json({ error: "transfer is reserved for another caller" }, { status: 400 });

    const res = await sendRelayCalls(await getDb(), "cctp_receive", [
      {
        target: MESSAGE_TRANSMITTER_V2,
        callData: encodeFunctionData({ abi: messageTransmitterAbi, functionName: "receiveMessage", args: [message, input.attestation as Hex] }),
        label: "receiveMessage",
      },
    ]);
    if (res.ok) return Response.json({ ok: true, tx: res.tx });
    // A nonce that is already used means someone (Circle's forwarder, the user, an earlier call) minted it.
    if (/nonce already used|already received/i.test(res.error)) return Response.json({ ok: true, already: true });
    return Response.json({ error: res.error }, { status: 502 });
  } catch (err) {
    return errorResponse(err);
  }
}
