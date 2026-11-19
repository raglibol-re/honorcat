import { describe, expect, it } from "vitest";
import { nickname, tagName } from "../../web/src/lib/nickname";

describe("one shown name identifies one player", () => {
  it("adds a short tag from the account", () => {
    expect(tagName("Velvet", "0x6caBe0AA69bdbb14a93c225c759fca27cf2bdc19")).toBe("Velvet·c19");
    expect(tagName("you", "0x6caBe0AA69bdbb14a93c225c759fca27cf2bdc19")).toBe("you");
    expect(tagName("Velvet·c19", "0x6caBe0AA69bdbb14a93c225c759fca27cf2bdc19")).toBe("Velvet·c19");
  });
  it("two accounts with the same name never look the same (unless their last 3 hex digits match)", () => {
    const seen = new Map<string, string>();
    for (let i = 0; i < 4000; i++) {
      const a = `0x${i.toString(16).padStart(40, "0")}`;
      const shown = tagName(nickname(a), a);
      const other = seen.get(shown);
      if (other) expect(other.slice(-3)).toBe(a.slice(-3));
      seen.set(shown, a);
    }
  });
});
