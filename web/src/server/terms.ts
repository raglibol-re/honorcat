import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getAddress } from "viem";
import { getConfig, type GuaranteeTerms } from "@honorcat/relay";

/**
 * The merchant signs an authorization whose nonce commits to the exact pot terms (deadline
 * included). The server prepares those terms from live market data and seals them with an HMAC,
 * so the submit step can trust them without re-deriving times that would have moved on.
 */
export type TermsJson = Omit<GuaranteeTerms, "refund"> & { refund: string };

function key() {
  const k = getConfig().adminToken ?? process.env.CRON_SECRET;
  if (!k) throw new Error("ADMIN_TOKEN is required to seal guarantee terms");
  return createHmac("sha256", k).update("verdict-guarantee-terms-v1").digest();
}

const canonical = (t: TermsJson) =>
  JSON.stringify([
    t.template,
    t.merchantName,
    getAddress(t.merchant),
    t.eventTicker,
    t.contractTicker,
    t.side,
    t.eventTitle,
    t.contractLabel,
    t.promise,
    t.refund,
    t.maxCustomers,
    t.lockTime,
    t.settlesAt,
    t.deadline,
    t.listed !== false,
  ]);

export function sealTerms(t: TermsJson): string {
  return createHmac("sha256", key()).update(canonical(t)).digest("base64url");
}

export function checkSeal(t: TermsJson, seal: string): boolean {
  const a = Buffer.from(sealTerms(t));
  const b = Buffer.from(seal);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const toTerms = (t: TermsJson): GuaranteeTerms => ({ ...t, merchant: getAddress(t.merchant), refund: BigInt(t.refund) });
