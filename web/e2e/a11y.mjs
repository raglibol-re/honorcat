// Screenshots + axe + overflow for a list of pages: node shoot2.mjs <base> <path> [<path> ...]
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// screenshots and logs go to e2e/out (ignored by git)
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
process.chdir(fileURLToPath(new URL("./out/", import.meta.url)));
import { readFileSync } from "node:fs";
const axe = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const exe = process.env.CHROME_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const [base, ...paths] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
for (const path of paths) {
  for (const [name, opts] of [["desktop", { viewport: { width: 1280, height: 900 } }], ["phone", devices["Pixel 7"]]]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const r = await page.goto(base + path, { waitUntil: "load", timeout: 90_000 }).catch((e) => ({ status: () => String(e).slice(0, 80) }));
    await page.waitForTimeout(5000);
    const file = `${path.replace(/[^a-z0-9]+/gi, "_")}-${name}.png`;
    await page.screenshot({ path: file, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.addScriptTag({ content: axe });
    const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa"] })).violations.map((x) => `${x.id}: ${x.nodes.length}`));
    console.log(path, name, r?.status?.(), { overflow, axe: v, file });
    await ctx.close();
  }
}
await browser.close();
