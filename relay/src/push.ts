import webpush from "web-push";
import type { Db } from "./db";

/**
 * Browser push notifications (Web Push, VAPID) for the people in a pot: someone joined, the pot
 * is live, a side asked to leave, the pot ended. Nothing personal is stored: a browser's push
 * subscription and the pot it is for. Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY.
 */
const SUBJECT = "https://honorcat.vercel.app";

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

function configured() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(SUBJECT, pub, priv);
  return true;
}

export type PushSubscriptionJson = { endpoint: string; keys: { p256dh: string; auth: string } };

export async function savePushSub(db: Db, input: { potId: string; account: string | null; subscription: PushSubscriptionJson }) {
  const s = input.subscription;
  if (!/^https:\/\//.test(s.endpoint) || !s.keys?.p256dh || !s.keys?.auth) throw Object.assign(new Error("not a push subscription"), { status: 400 });
  const n = await db.query<{ n: string }>("SELECT count(*)::text AS n FROM push_subs WHERE pot_id = $1", [input.potId]);
  if (Number(n[0]?.n ?? 0) >= 20) throw Object.assign(new Error("too many subscriptions for this pot"), { status: 429 });
  await db.query(
    `INSERT INTO push_subs (endpoint, pot_id, account, sub) VALUES ($1,$2,$3,$4)
     ON CONFLICT (endpoint, pot_id) DO UPDATE SET sub = EXCLUDED.sub, account = EXCLUDED.account`,
    [s.endpoint, input.potId, input.account?.toLowerCase() ?? null, JSON.stringify(s)],
  );
}

/** Sends one notification to every browser that asked for this pot; drops subscriptions that are gone. */
export async function notifyPot(db: Db, potId: string, title: string, body: string) {
  if (!configured()) return 0;
  const subs = await db.query<{ endpoint: string; sub: PushSubscriptionJson | string }>("SELECT endpoint, sub FROM push_subs WHERE pot_id = $1", [potId]);
  let sent = 0;
  const payload = JSON.stringify({ title, body, url: `/pots/${potId}` });
  for (const r of subs) {
    const sub = typeof r.sub === "string" ? (JSON.parse(r.sub) as PushSubscriptionJson) : r.sub;
    try {
      await webpush.sendNotification(sub, payload, { TTL: 3600 });
      sent++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.query("DELETE FROM push_subs WHERE endpoint = $1 AND pot_id = $2", [r.endpoint, potId]);
    }
  }
  return sent;
}

/** The message for a pot's change of state, if worth a notification. */
export function stateMessage(potId: string, from: number | null, to: number): { title: string; body: string } | null {
  if (from === to) return null;
  const t = `Pot ${potId}`;
  switch (to) {
    case 2:
      return { title: t, body: "Someone is taking the other side. The entry price is being measured." };
    case 3:
      return from === 2 ? { title: t, body: "The pot is live. Your share now follows the price." } : from === 4 ? { title: t, body: "The pot continues: the exit could not be priced, or someone took over." } : null;
    case 4:
      return { title: t, body: "A side asked to leave. The exit price is being measured." };
    case 5:
      return { title: t, body: "Divided: both sides were paid their shares." };
    case 6:
      return { title: t, body: "Settled by Gemini's result. The pot has been paid out." };
    case 7:
      return { title: t, body: "Closed: the deposits went back." };
    default:
      return null;
  }
}
