// Run: npm i --no-save playwright-core && node relay/scripts/phone-solo.mjs (uses a Playwright Chromium in %LOCALAPPDATA%/ms-playwright).
// Phone-width solo run against production: new passkey, practice pot, rope, exit. Times the whole thing.
import { chromium, devices } from "playwright-core";

const BASE = process.env.BASE ?? "https://honorcat.vercel.app";
const OUT = process.env.OUT ?? "./";
const exe = process.env.CHROME ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ ...devices["iPhone 13"], defaultBrowserType: undefined });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
});
const t0 = Date.now();
const log = (s) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${s}`);
const shot = (n) => page.screenshot({ path: `${OUT}${n}.png`, fullPage: false });
page.on("pageerror", (e) => console.log("pageerror", e.message));

try {
  await page.goto(`${BASE}/pots/new?practice=1`);
  log("start page");
  const pick = page.locator('[role=radiogroup][aria-label=Markets] button[aria-disabled=false]').first();
  await pick.waitFor({ timeout: 30_000 });
  await pick.click();
  log("market picked");
  await page.getByRole("button", { name: "Create a passkey" }).click();
  log("passkey requested");
  const start = page.getByRole("button", { name: /practice cat|Start the pot/ });
  await start.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /practice cat/.test(x.textContent ?? ""));
    return b && !b.disabled;
  }, null, { timeout: 60_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  log(`signed in; horizontal overflow ${overflow}px`);
  await shot("1-create");
  await start.click();
  await page.waitForURL(/\/pots\/\d+/, { timeout: 120_000 });
  log(`pot page ${page.url()}`);
  const leave = page.getByRole("button", { name: /Leave with my whole share/ });
  await leave.waitFor({ timeout: 120_000 });
  await page.waitForFunction(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Leave with my whole share/.test(x.textContent ?? ""));
    return b && !b.disabled;
  }, null, { timeout: 120_000 });
  log("pot live, rope showing");
  await shot("2-live");
  await leave.click();
  const confirm = page.getByRole("button", { name: /^(Yes, leave|Confirm)/ });
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
    await shot("3-confirm");
    await confirm.click();
  }
  log("exit requested");
  const id = page.url().match(/pots\/(\d+)/)[1];
  for (;;) {
    const st = await page.evaluate(async (i) => (await (await fetch(`/api/hc/pots/${i}`)).json()).state, id);
    if (st === "Divided" || st === "Settled") break;
    const alert = await page.locator("[role=alert]").allInnerTexts();
    if (alert.length) console.log("alert:", alert.join(" | "));
    if (Date.now() - t0 > 300_000) throw new Error(`still ${st}`);
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(2500);
  log("paid out");
  await shot("4-done");
  const total = (Date.now() - t0) / 1000;
  console.log(JSON.stringify({ ok: true, seconds: total, url: page.url(), overflow }));
} catch (e) {
  await shot("error");
  console.log("FAILED", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
