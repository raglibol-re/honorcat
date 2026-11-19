/* Shared by the browser and the server (link previews): no client-only code here. */

const NICKNAMES = [
  "Mittens", "Pepper", "Biscuit", "Tabby", "Socks", "Ginger", "Mochi", "Pixel", "Nutmeg", "Clover", "Pumpkin", "Shadow", "Toffee", "Juniper", "Marble", "Saffron",
  "Pebble", "Hazel", "Comet", "Velvet", "Maple", "Olive", "Sesame", "Cricket", "Bramble", "Willow", "Sprout", "Tofu", "Paprika", "Moss", "Echo", "Puddle",
];

/** A stable cat nickname for an account without a display name (no address shown). */
export function nickname(account: string): string {
  const h = parseInt(account.slice(-6), 16) || 0;
  return NICKNAMES[h % NICKNAMES.length]!;
}

/**
 * A name with a short tag from the account ("Velvet·7f3"), so two players with the same name never
 * look the same. Applied wherever a player is shown; "you" and "open seat" stay as they are.
 */
export function tagName(name: string, account: string | null | undefined): string {
  if (!account || !/^0x[0-9a-fA-F]{40}$/.test(account)) return name;
  const tag = account.slice(-3).toLowerCase();
  if (name === "you" || name === "open seat" || name.endsWith(`·${tag}`)) return name;
  if (name.startsWith("you (") && name.endsWith(")")) return `you (${tagName(name.slice(5, -1), account)})`;
  return `${name}·${tag}`;
}
