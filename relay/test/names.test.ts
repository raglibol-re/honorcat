import { describe, expect, it } from "vitest";
import { memoryDb } from "../src/db";
import { catsOf, cleanName, FURS, nameMessage } from "../src/names";

describe("cat names", () => {
  it("keeps names short and plain", () => {
    expect(cleanName("  Mochi   the  Brave ")).toBe("Mochi the Brave");
    expect(() => cleanName("x")).toThrow(/2 to 20/);
    expect(() => cleanName("a".repeat(21))).toThrow(/2 to 20/);
    expect(() => cleanName("<script>")).toThrow(/letters, digits/);
    expect(() => cleanName("Practice Cat")).toThrow(/reserved/);
  });
  it("refuses offensive names, also when disguised", () => {
    for (const bad of ["fuck", "FuCk you", "sh1t head", "b i t c h"]) expect(() => cleanName(bad), bad).toThrow(/not allowed/);
    for (const ok of ["Scunthorpe", "Cassie", "Pepper"]) expect(cleanName(ok)).toBe(ok);
  });
  it("signs the fur with the name, and only when chosen", () => {
    const a = "0x00000000000000000000000000000000000000aa";
    expect(nameMessage(a, "Mochi", "2026-11-16T00:00:00Z", "ginger")).toContain("My cat's fur: ginger");
    expect(nameMessage(a, "Mochi", "2026-11-16T00:00:00Z")).not.toContain("fur");
  });
  it("returns names and furs together", async () => {
    const db = await memoryDb();
    await db.query("INSERT INTO display_names (account, name, fur) VALUES ('0x00000000000000000000000000000000000000aa', 'Mochi', 'ginger'), ('0x00000000000000000000000000000000000000bb', 'Tofu', NULL)");
    const r = await catsOf(db, ["0x00000000000000000000000000000000000000AA", "0x00000000000000000000000000000000000000bb"]);
    expect(r.names["0x00000000000000000000000000000000000000aa"]).toBe("Mochi");
    expect(r.furs["0x00000000000000000000000000000000000000aa"]).toBe("ginger");
    expect(r.furs["0x00000000000000000000000000000000000000bb"]).toBeUndefined();
    expect(FURS).toContain("black");
  });
});
