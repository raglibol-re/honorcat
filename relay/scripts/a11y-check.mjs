// Run: npm i --no-save playwright-core axe-core && node relay/scripts/a11y-check.mjs [desktop]  (phone width by default)
// Phone width + keyboard + axe-core on each page. node a11y.mjs [desktop]
import { chromium, devices } from "playwright-core";
import { readFileSync } from "node:fs";
const axe = readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const exe = process.env.CHROME ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const routes = ["", "pots", "pots/new", "pots/22", "pots/22/terms", "pots/22/proof", "pots/together", "markets", "how", "account", "status", "live", "how-it-is-built", "developers", "record/0xf1eb955bd6329285e39c87ade8199c9750bff569", "pots/17/tv"];
const b = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await b.newContext(process.argv[2] ? { viewport: { width: 1280, height: 900 } } : { ...devices["iPhone 13"], defaultBrowserType: undefined });
let bad = 0;
for (const r of routes) {
  const page = await ctx.newPage();
  await page.goto("https://honorcat.vercel.app/" + r, { waitUntil: "load" }).catch(() => {});
  await page.waitForTimeout(4000);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.addScriptTag({ content: axe });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] }, resultTypes: ["violations"] });
    return r.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  // keyboard: tab through up to 60 stops; each must be visible on screen and named
  const kb = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      const box = e.getBoundingClientRect();
      const name = (e.getAttribute("aria-label") || e.innerText || e.getAttribute("title") || e.getAttribute("value") || (e.labels && e.labels[0] && e.labels[0].innerText) || "").trim();
      const tag = e.tagName.toLowerCase();
      return { tag, name: name.slice(0, 40), visible: box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < window.innerHeight };
    });
    if (!f) break;
    if (!f.visible || (!f.name && f.tag !== "input" && f.tag !== "select")) kb.push(`${f.tag}:${f.name || "(no name)"}${f.visible ? "" : " (off screen)"}`);
  }
  const issues = res.length + kb.length + (overflow > 0 ? 1 : 0);
  bad += issues;
  console.log(`/${r}: overflow ${overflow}px, axe ${res.length}, keyboard ${kb.length}`);
  for (const x of res) console.log("   axe", x);
  for (const x of [...new Set(kb)].slice(0, 6)) console.log("   key", x);
  await page.close();
}
console.log("total issues", bad);
await b.close();
