import "server-only";
import { z } from "zod";
import type { WebAuthnAssertion } from "@verdict/relay";

/** A WebAuthn assertion as the browser sends it (hex fields, JSON string, indexes). */
export const assertionBody = z
  .object({
    authenticatorData: z.string().regex(/^0x[0-9a-fA-F]{74,2000}$/),
    clientDataJSON: z.string().min(20).max(2000),
    challengeIndex: z.number().int().min(0).max(2000),
    typeIndex: z.number().int().min(0).max(2000),
    r: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
    s: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/),
  })
  .transform((a) => a as unknown as WebAuthnAssertion);

/** The relying party is the host the browser talks to; passkeys are bound to it. */
export const rpIdOf = (req: Request) => new URL(req.url).hostname;
