import { z } from "zod";
import {
  authorizationBody,
  errorResponse,
  getDb,
  integrationFrom,
  nudgeRelay,
  potParamsBody,
  submitGaslessCreate,
  uint,
} from "@/server/relay";

export const maxDuration = 60;

const body = z.object({ params: potParamsBody, amount: uint, authorization: authorizationBody });

/** Relays `createPotWithAuthorization`: create + fund in one transaction; the funder only signs. */
export async function POST(req: Request) {
  try {
    const { params, amount, authorization } = body.parse(await req.json().catch(() => null));
    const me = await integrationFrom(req);
    const res = await submitGaslessCreate(await getDb(), { params, amount, auth: authorization }, me?.id ?? null);
    nudgeRelay("gasless:create");
    return Response.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
