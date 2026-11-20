// Perps through the real pages, two players with virtual passkeys: node perp-ui.mjs <base> [search] [contract label]
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
// screenshots and logs go to e2e/out (ignored by git)
mkdirSync(new URL("./out/", import.meta.url), { recursive: true });
process.chdir(fileURLToPath(new URL("./out/", import.meta.url)));
const exe = process.env.CHROME_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1254/chrome-win64/chrome.exe`;
const base = process.argv[2] ?? "https://honorcat.vercel.app";
const search = process.argv[3] ?? "ZEC";
const contract = process.argv[4] ?? "$940 or above";
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const browser = await chromium.launch({ executablePath: exe });

async function player(name, phone) {
  const ctx = await browser.newContext(phone ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  page.on("pageerror", (e) => log(`${name} page error: ${String(e).slice(0, 160)}`));
  return { ctx, page, name };
}
const shot = (p, f) => p.page.screenshot({ path: f, fullPage: true }).then(() => log(`saved ${f}`));
async function signIn(p) {
  const b = p.page.getByRole("button", { name: "Sign up in one tap" }).first();
  await b.waitFor({ timeout: 60_000 });
  await b.click();
  await p.page.getByRole("button", { name: "Sign up in one tap" }).first().waitFor({ state: "detached", timeout: 60_000 });
  log(`${p.name} signed in with a new passkey`);
}
async function waitText(p, re, ms = 300_000) {
  await p.page.getByText(re).first().waitFor({ timeout: ms });
}

const A = await player("A");
await A.page.goto(`${base}/pots/new?kind=perp&perps=preview`, { waitUntil: "load" });
await A.page.waitForTimeout(6000); // let the page hydrate before typing
await A.page.getByPlaceholder(/Search/).pressSequentially(search, { delay: 80 });
await A.page.waitForTimeout(6000);
const usableRow = A.page.locator('button[role="radio"][aria-disabled="false"]', { hasText: contract });
const anyUsable = A.page.locator('button[role="radio"][aria-disabled="false"]').filter({ hasNotText: /^(Normal|Perp)/ });
if (await usableRow.count()) await usableRow.first().click();
else {
  log(`"${contract}" is not usable now; taking the first usable market for "${search}"`);
  await anyUsable.first().click({ timeout: 60_000 });
}
log("A picked the market");
await A.page.getByLabel("Stake per life (USDC)").fill("0.1");
await A.page.getByRole("textbox", { name: "Lives", exact: true }).fill("2");
await A.page.getByLabel("Each rope lasts at most").selectOption({ label: "10 minutes" });
await A.page.waitForTimeout(2000);
await shot(A, "ui-1-form.png");
await signIn(A);
const give = A.page.getByRole("button", { name: /^Give your word/ });
await give.waitFor();
log(`A presses: ${await give.textContent()}`);
await give.click();
await A.page.waitForURL(/\/perps\/\d+/, { timeout: 240_000 }).catch(async (e) => {
  await shot(A, "ui-err-open.png");
  const alert = await A.page.getByRole("alert").first().textContent().catch(() => null);
  throw new Error(`open failed: ${alert ?? e}`);
});
const id = A.page.url().match(/perps\/(\d+)/)[1];
log(`perp ${id} opened through the form`);
await A.page.waitForTimeout(4000);
await shot(A, "ui-2-open.png");

const B = await player("B", true);
await B.page.goto(`${base}/perps/${id}`, { waitUntil: "load" });
await waitText(B, "Take the other side", 60_000);
await signIn(B);
await B.page.getByRole("textbox", { name: "Your lives" }).fill("1");
const join = B.page.getByRole("button", { name: /Give your word and join/ });
log(`B presses: ${await join.textContent()}`);
await join.click();
await waitText(B, /Both are in|first rope is starting|Rope 1 is running/, 240_000).catch(async (e) => {
  await shot(B, "ui-err-join.png");
  const alert = await B.page.getByRole("alert").first().textContent().catch(() => null);
  throw new Error(`join failed: ${alert ?? e}`);
});
log("B joined");
await waitText(B, "Rope 1 is running", 300_000);
log("rope 1 running (started by the relay)");
await B.page.waitForTimeout(5000);
await shot(B, "ui-3-running-phone.png");
await A.page.reload();
await waitText(A, "Rope 1 is running", 60_000);
await shot(A, "ui-3-running.png");

await B.page.getByRole("button", { name: "Leave now", exact: true }).click();
await B.page.getByText("Leave now and end the perp?").waitFor({ timeout: 10_000 });
await shot(B, "ui-3b-confirm-phone.png");
await B.page.getByRole("button", { name: "Yes, leave now" }).click();
log("B confirmed Leave now");
await waitText(B, /Ended after/, 300_000);
log("perp ended after B left");
await B.page.waitForTimeout(3000);
await shot(B, "ui-4-ended-phone.png");
await A.page.reload();
await waitText(A, /Ended after/, 60_000);
const out = A.page.getByRole("button", { name: /^Take out/ });
if (await out.count()) {
  log(`A presses: ${await out.first().textContent()}`);
  await out.first().click();
  await A.page.waitForTimeout(15_000);
}
const outB = B.page.getByRole("button", { name: /^Take out/ });
if (await outB.count()) {
  log(`B presses: ${await outB.first().textContent()}`);
  await outB.first().click();
  await B.page.waitForTimeout(15_000);
}
await A.page.reload();
await A.page.waitForTimeout(5000);
await shot(A, "ui-5-final.png");
log(`done: perp ${id}`);
await browser.close();
