// A practice pot through the real pages with a virtual passkey: node practice-ui.mjs <base>
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// screenshots and logs go to e2e/out (ignored by git)
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
process.chdir(fileURLToPath(new URL("./out/", import.meta.url)));
const exe = process.env.CHROME_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const base = process.argv[2] ?? "https://honorcat.vercel.app";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.launch({ executablePath: exe });
const ctx = await browser.newContext(devices["Pixel 7"]);
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
page.on("pageerror", (e) => log(`page error: ${String(e).slice(0, 160)}`));
const shot = (f) => page.screenshot({ path: f, fullPage: true }).then(() => log(`saved ${f}`));

await page.goto(`${base}/pots/new?practice=1`, { waitUntil: "load" });
await page.waitForTimeout(6000);
await page.locator('button[role="radio"][aria-disabled="false"]').filter({ hasNotText: /^(Normal|Perp)/ }).first().click({ timeout: 60_000 });
log("picked a market");
await page.waitForTimeout(2500);
const practise = page.getByRole("checkbox");
if (!(await practise.isChecked())) await practise.check();
await page.getByRole("button", { name: "Sign up in one tap" }).first().click();
await page.getByRole("button", { name: "Sign up in one tap" }).first().waitFor({ state: "detached", timeout: 60_000 });
log("signed in");
const give = page.getByRole("button", { name: /Give your word/ });
await give.waitFor();
await page.waitForTimeout(4000); // the welcome money
log(`pressing: ${await give.textContent()}`);
await give.click();
await shot("pr-1-busy.png");
await page.waitForURL(/\/pots\/\d+/, { timeout: 240_000 }).catch(async (e) => {
  await shot("pr-err.png");
  throw new Error(`create failed: ${(await page.getByRole("alert").first().textContent().catch(() => null)) ?? e}`);
});
log(`practice pot ${page.url().match(/pots\/(\d+)/)[1]} opened`);
const leave = page.getByRole("button", { name: /^(Leave with my whole share|Leave now)/ }).first();
await leave.waitFor({ timeout: 240_000 });
log("live: the practice cat joined and the entry price was measured");
await shot("pr-2-live.png");
await leave.click();
await page.getByRole("button", { name: /^Yes, leave/ }).first().click();
log("asked to leave");
await page.getByText(/You got \$/).first().waitFor({ timeout: 240_000 });
log("divided: the result banner shows");
await page.waitForTimeout(3000);
await shot("pr-3-result.png");
await browser.close();
