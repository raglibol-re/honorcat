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
