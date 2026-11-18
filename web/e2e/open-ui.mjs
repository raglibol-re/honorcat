// An open pot nobody joined, seen by its creator: node open-ui.mjs <base> [phone]
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// screenshots and logs go to e2e/out (ignored by git)
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
process.chdir(fileURLToPath(new URL("./out/", import.meta.url)));
const exe = process.env.CHROME_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const base = process.argv[2] ?? "https://honorcat.vercel.app";
const phone = process.argv[3] === "phone";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
page.on("pageerror", (e) => log(`page error: ${String(e).slice(0, 160)}`));
const shot = (f) => page.screenshot({ path: f, fullPage: true }).then(() => log(`saved ${f}`));

await page.goto(`${base}/pots/new`, { waitUntil: "load" });
await page.waitForTimeout(6000);
await page.locator('button[role="radio"][aria-disabled="false"]').filter({ hasNotText: /^(Normal|Perp)/ }).first().click({ timeout: 60_000 });
await page.getByRole("textbox", { name: "What you put in (USDC)" }).fill("0.5").catch(() => {});
await page.getByRole("button", { name: "Create a passkey" }).first().click();
await page.getByRole("button", { name: "Create a passkey" }).first().waitFor({ state: "detached", timeout: 60_000 });
await page.waitForTimeout(4000);
const give = page.getByRole("button", { name: /^Give your word$/ });
await give.click();
await page.waitForURL(/\/pots\/\d+/, { timeout: 240_000 });
const id = page.url().match(/pots\/(\d+)/)[1];
log(`open pot ${id}`);
await page.waitForTimeout(8000);
await shot(`open-${phone ? "phone" : "desk"}.png`);
const buttons = await page.getByRole("button").allTextContents();
log(`buttons: ${buttons.map((b) => b.trim()).filter(Boolean).join(" | ")}`);
const back = page.getByRole("button", { name: /Cancel and get my/ });
if (await back.count()) {
  await back.first().click();
  log("pressed take back");
  await page.getByText(/Nobody joined, so nothing was played/i).first().waitFor({ timeout: 120_000 }).catch(() => log("no confirmation text seen"));
  await page.waitForTimeout(5000);
  await shot(`open-after-${phone ? "phone" : "desk"}.png`);
} else log("NO take-back button");
await browser.close();
