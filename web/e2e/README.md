# Browser tests of the real pages

Each script opens HonorCat in Chromium with a **virtual passkey** (the browser's WebAuthn test
authenticator), so it signs in and confirms exactly like a player, with test money on Arc testnet.
Run them against production after a deploy, or against a local build (`next start`).

```sh
cd web/e2e
npm install                      # playwright-core and axe-core only; no browser download
# Chromium: set CHROME_PATH, or install one with `npx playwright install chromium`
node practice-ui.mjs https://honorcat.vercel.app        # practice pot: create, the practice cat joins, leave, paid
node open-ui.mjs https://honorcat.vercel.app phone      # open a pot, nobody joins, cancel and get the money back
node perp-ui.mjs https://honorcat.vercel.app            # two players: open a perp, join, rope 1, leave now, take out
node practice-perp-ui.mjs https://honorcat.vercel.app   # a perp against the practice cat
node a11y.mjs https://honorcat.vercel.app / /pots /pots/new /markets /account   # axe + no sideways scroll, desktop and phone
```

Screenshots and logs go to `e2e/out/` (not committed). Each run uses fresh passkey accounts; test
money comes from HonorCat's own pool, as for any new player.

What each one proved on 2026-11-18 (production): practice pot 30 (v1) and 2000000010 (v2), open and
cancel pots 31 and 32, perps 5 and 6 (two players), practice perp 7.
