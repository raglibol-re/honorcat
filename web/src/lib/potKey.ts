/**
 * The keys of private pots this browser may see (from a private link's ?k=, after making a pot
 * private, or after a player unlocked it with a signature). Every request for such a pot carries it.
 */
const name = (id: string) => `hc.pkey.${id}`;

export function getPotKey(id: string): string | null {
  try {
    return localStorage.getItem(name(id));
  } catch {
    return null;
  }
}

export function setPotKey(id: string, key: string) {
  try {
    localStorage.setItem(name(id), key);
  } catch {
    /* private window: the link keeps working through ?k= */
  }
}

/** Adds the pot's key (?k=) to a request for /api/hc/pots/<id>… when this browser has one. */
export function withPotKey(path: string): string {
  const m = /^\/api\/hc\/pots\/(\d+)(?:[/?]|$)/.exec(path);
  if (!m || /[?&]k=/.test(path) || typeof window === "undefined") return path;
  const k = getPotKey(m[1]!);
  return k ? `${path}${path.includes("?") ? "&" : "?"}k=${encodeURIComponent(k)}` : path;
}
