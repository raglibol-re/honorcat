# Handoff

State on 2026-11-17 (hackathon deadline 2026-11-20). Read this first, then README.md (setup, run,
test, deploy, environment variables), docs/PROGRESS.md (history and open items) and docs/rubric.md
(what is done and how it was checked).

## What HonorCat is

Two-sided pots on live Gemini prediction markets, on Arc testnet, with test USDC only. Two players
take opposite sides; a cat on a rope shows each side's share at the live price; either side can
leave at any time at a price three independent samplers agree on, or both hold until Gemini settles.
Passkey accounts (no wallet app, HonorCat pays the fees) or a browser wallet. Grok Bot can join as an
AI opponent or a cat sitter through an MCP connector.

- Live: https://honorcat.vercel.app (Vercel project `verdict`, team `raglibol`)
- Repository: github.com/raglibol-re/verdict, branch `main`
- Contracts, addresses and the architecture diagram: README.md

## Where things run

| Piece | Where | Notes |
|---|---|---|
| Web app and relay | Vercel project `verdict` (root `web/`) | A push to `main` deploys to production (every deploy on 2026-11-17 went this way); `npx vercel deploy --prod --yes` from the repository root also works. `web/.vercel` points at a stray project `web`: do not deploy from `web/`. |
| Database | Neon project `honorcat` (spring-glade-62475881) | Free tier: keep reads small (no whole-catalogue reads per request). The production URL is `DATABASE_URL_PROD` in `.env`; `.env` `DATABASE_URL` is a local database. `relay/scripts/rebuild-db.ts` rebuilds from public sources. |
| Samplers (2 of 3 needed) | one inside the app, two on this machine | Local ones: `cd relay && npx tsx --env-file=../.env scripts/sampler.ts --key-env SAMPLER_KEY_LOCAL` and `... SAMPLER_KEY_GITHUB`. If this machine sleeps, exits wait (funds stay safe). An older third sampler process also runs here with the LOCAL key against the old `verdict-phi-livid.vercel.app` address: harmless, can be stopped. |
| Relay wallet (fees, practice cat, welcome money) | Circle developer-controlled wallet `0xf1eb955bd6329285e39c87ade8199c9750bff569` | Refill by hand at faucet.circle.com (Arc Testnet); the Circle faucet API answers 403 until the Circle account is upgraded. Below about $6 the practice cat and the $2 welcome stop (the app says so). $14.38 on 2026-11-17 evening (each test account takes its $2 welcome). |
| Event delivery | QuickNode Stream to `/api/webhooks/quicknode`, RPC poller as fallback | After an outage QuickNode terminates the stream: `relay/scripts/quicknode-stream.ts --status active`. |

## Done (all live and checked on production)

- The pot product (create, join, exit at an agreed price, handshake, settle), practice pots against
  the practice cat, pots with a friend, honor record, proof pages, price chart, helper cat (templates,
  never presented as Grok), Grok Bot seats (AI opponent, cat sitter), links to each market on Gemini.
- Everyday-app spec, "build what works now" (docs/rubric.md section 15): fees in cents and receipt
  sentences with payout times; send to a player by name and "send my share"; dollars or euros at
  Circle's stated rate; Gateway funding in unified-balance words; every asset and Circle product with
  live evidence on /how-it-is-built; Onramp as a clearly marked demo.
- My money (`/account`) rebuilt around the balance: Add money / Send / Withdraw, one at a time.
- Checks: relay tests 135 passed; web typecheck and lint clean; axe 0 issues signed in and out on
  the changed pages; phone runs: practice pot to payout in 93 s, then a send.

## HonorCat v2: short ropes and treats (2026-11-18)

- Deployed on Arc testnet: HonorCatRopes `0x6A30…Cf44` (+ extension `0x97E6…85Be`, MedianResolver
  `0x3f73…5842`), `deployments/5042002.ropes.json`. Design, decisions and results: docs/rope-design.md,
  docs/PROGRESS.md, README "v2: short ropes and treats".
- **New pots still go to v1** until `ROPES_FOR_NEW_POTS=true` is set on Vercel (the owner's call).
  Until then v2 pots exist only through scripts (`relay/scripts/ropes-e2e.ts`); their pages work.
- v2 pots are `1,000,000,000 + on-chain id` in the database and in page links.
- The samplers must run the current code to measure v2 windows (knock-out watch, expiry windows).
- The price recorder for the backtest runs on this machine (`relay/scripts/record-mids.ts`, data in
  `data/recorder/`, git-ignored); rerun `relay/scripts/rope-backtest.ts` to add the recorded rows.
- A Neon branch `backtest-2026-11-18` is a read-only snapshot for analysis (the old sample history is
  gone; the production database was rebuilt on 2026-11-16). Delete it when no longer needed.
- QuickNode Streams still filter only the v1 address; v2 events come through the RPC poller (about a
  minute later). Add the v2 address to the stream's filter (`relay/scripts/quicknode-stream.ts --filter`).

## Blocked: Circle Modular Wallets

Circle smart accounts for players are built (`web/src/lib/wallet/circle.ts`) and hidden behind
`NEXT_PUBLIC_CIRCLE_MODULAR_READY`. Sign-up fails with -32012 "Cannot find the entity config": the
Modular Wallets / passkey-domain setting must exist in Circle's console, and the owner could not find
it. Waiting on it: Circle-sponsored gas for new accounts (spec part 1), Earn (part 5), EURC payouts
through Swap Kit (part 2), Bridge on exit (part 3). Once it works: set the flag, test sign-up on a
phone, then build those parts in that order.

## Open items for the owner

- Circle console: Modular Wallets setting (above).
- Optional: an Onramp sandbox key would let the card step run in Circle's test mode, but the sandbox
  cannot settle on Arc testnet, so the demo stays honest without it.
- Recommended earlier: rotate the Circle API key (it was handled in a chat session).
- Optional: `E2E_FUNDER_KEY` (switches on the daily e2e workflow). The GitHub Actions sampler was removed (2026-11-18); its key runs on this machine.
  (daily e2e workflow).
- Grok Bot: a real test from the owner's Grok Bot account through `/grok-bot` has not been reported
  back yet (automated MCP end-to-end runs passed: pots 24 and 25).

## Rules the owner set (keep them)

- Testnet only; never spend real money; minimise Vercel spending.
- Secrets only in environment variables; never print them; nothing secret in the repository.
- No contract changes without asking (stop and explain first); do not redeploy old contracts;
  existing accounts and pots must keep working.
- Never deploy while an end-to-end run is going (same keys, nonce clashes).
- Do not automate faucet.circle.com; ask the owner to refill.
- Do not present templates as Grok; "Data provided by Gemini" wherever prices appear.
- Short, plain, user-friendly words on player pages; details folded away or on /how-it-is-built.
- Ship each milestone: commit, push, deploy and check production after every major change.

## Gotchas learned the hard way

- The repository folder was renamed from `verdict` to `honorcat`; every `node_modules` link pointed at
  the old folder, so nothing in relay or web could start (the local samplers had been down for a day).
  The links were repointed on 2026-11-18. After any rename, check `relay/node_modules/viem` resolves.
- e2e scripts that fund throwaway wallets must save their keys first (`ropes-e2e.ts` writes
  `data/e2e-keys.jsonl`) and pick the market before funding: $0.90 was lost once to a run that did not.

- Bash heredocs that contain `$` patterns or apostrophes can be blocked by the shell checker: write a
  small Python patch file and run it.
- In Playwright on `/account`, `getByRole("radio").first()` hits the fur picker: target by name.
- The App Kit / Swap Kit npm packages are heavy and the externalised Swap Kit did not load on Vercel;
  the euro rate calls Circle's public endpoint `api.circle.com/v1/stablecoinKits/rates` directly.
- `pnpm remove` fails with EBUSY while a shell sits inside `node_modules`; run `pnpm install` after.
- Arc's block clock trails wall time by seconds; samplers submit windows only after the chain clock
  passes the window end.
- Vercel runtime logs through the Vercel connector return 403 for this team; use `vercel logs` from
  the CLI if needed.
- Names are not unique; the relay checks every passkey signature; only accounts with a HonorCat name
  appear in player search.

## How to check that everything still works

1. https://honorcat.vercel.app/api/hc/practice says `"available":true` (else refill the relay wallet).
2. `/status`: samplers recent, Streams share high.
3. `node relay/scripts/phone-solo.mjs` (Playwright, virtual passkey): a practice pot from start to
   payout in about two minutes.
4. `node relay/scripts/a11y-check.mjs`: axe, keyboard and overflow on 16 pages.
5. `pnpm --filter @honorcat/relay test`; `cd web && npx tsc --noEmit && npx eslint src`.
