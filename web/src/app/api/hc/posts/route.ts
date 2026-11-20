import { connection } from "next/server";
import { z } from "zod";
import { address, errorResponse, getDb, posts } from "@/server/relay";
import { assertionBody } from "@/server/webauthn";

const aboutBody = z.object({ kind: z.enum(["pot", "perp", "group"]), id: z.string().regex(/^\d{1,20}$/) });
const parseAbout = (s: string | null) => {
  const m = s?.match(/^(pot|perp|group):(\d{1,20})$/);
  return m ? { kind: m[1] as "pot" | "perp" | "group", id: m[2]! } : null;
};

/** Posts, newest first: everyone, ?following=<account>, ?author=<account> or ?about=pot:19. */
export async function GET(req: Request) {
  await connection();
  try {
    if (!posts.socialOn()) return Response.json({ on: false, posts: [] }, { headers: { "cache-control": "no-store" } });
    const q = new URL(req.url).searchParams;
    const following = q.get("following") ? address.parse(q.get("following")) : null;
    const author = q.get("author") ? address.parse(q.get("author")) : null;
    const list = await posts.listPosts(await getDb(), { following, author, about: parseAbout(q.get("about")), before: q.get("before") });
    return Response.json({ on: true, posts: list }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

const base = { account: address, body: z.string().min(1).max(2000), about: aboutBody.nullable().optional(), issuedAt: z.string().min(10).max(40) };
const body = z.union([z.object({ ...base, signature: z.string().regex(/^0x[0-9a-fA-F]+$/) }), z.object({ ...base, passkey: assertionBody })]);

/** A new post, signed by its author. */
export async function POST(req: Request) {
  await connection();
  try {
    const b = body.parse(await req.json());
    return Response.json(await posts.createPost(await getDb(), b as Parameters<typeof posts.createPost>[1]));
  } catch (err) {
    return errorResponse(err);
  }
}
