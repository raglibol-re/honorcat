# Verdict

Conditional USDC payouts on Circle's **Arc testnet**. USDC is locked in a pot and is paid out to
payees (by share) or refunded once an authorised resolver signs the outcome of an external event.

> Testnet only. Never use these keys or contracts on mainnet.

```
contracts/   Foundry (Arc Foundry) – VerdictVault.sol + tests + deploy script
relay/       Node + TypeScript – result sources, signer, indexer, REST API   (in progress)
web/         Next.js + Tailwind – create pot, pot status, live ledger         (in progress)
deployments/ <chainId>.json written by the deploy script (vault address, deploy block)
```

## Arc testnet facts (verified against docs.arc.io and the live RPC)

| | |
|---|---|
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.io` (WS: `wss://rpc.testnet.arc.io`) |
| Explorer | `https://explorer.testnet.arc.io` |
| USDC (ERC-20, 6 decimals) | `0x3600000000000000000000000000000000000000` |
| Faucet | `https://faucet.circle.com` → Arc Testnet |

Gas is paid in USDC (native balance has 18 decimals; all amount math goes through the ERC-20
interface). Min base fee is 20 gwei; `eth_getLogs` is limited to 10,000 blocks per call.

## Contract: `VerdictVault`

- `createPot(conditionId, resolver, payees[], sharesBps[], refundTo, deadline)` – shares sum to 10,000.
- `fund(potId, amount)` – anyone, repeatedly, until the deadline (needs USDC `approve`).
- `resolve(potId, outcome, signature)` – EIP-712 `Resolution(uint256 potId,bytes32 conditionId,bool outcome)`
  signed by the pot's resolver (EOA or ERC-1271). Domain: name `VerdictVault`, version `1`, chainId,
  verifyingContract. Anyone may submit. Allowed until `deadline + gracePeriod`.
- `expire(potId)` – after `deadline + gracePeriod`, refunds the whole pot to `refundTo`.
- `claim()` – if a transfer failed (e.g. a USDC-blocklisted recipient), the amount is credited as
  claimable instead of blocking the pot; the recipient withdraws it later.

Rounding: each payee gets `floor(total * bps / 10000)`; the last payee gets the remainder, so no dust
remains. **Refunds go to `refundTo` as a whole; third-party funders are not refunded individually**
(per-funder refunds are a possible later extension). No owner, no upgradeability.

Events: `PotCreated`, `PotFunded` (incl. funder), `PotResolved`, `PotExpired`, `Payout`, `Refund`,
`PaymentDeferred`, `Claimed`.

## Setup

Prerequisites: Node ≥ 22.5, pnpm 10, and on Windows **WSL (Ubuntu)** for the contracts.

### 1. Arc Foundry (WSL / Linux / macOS)

```bash
V=v0.8.0-4; T=arc-foundry-$V-x86_64-unknown-linux-gnu
curl -fsSLO https://github.com/circlefin/arc-foundry/releases/download/$V/$T.tar.gz
curl -fsSLO https://github.com/circlefin/arc-foundry/releases/download/$V/$T.tar.gz.sha256
sha256sum -c $T.tar.gz.sha256
mkdir x && tar -xzf $T.tar.gz -C x && mkdir -p ~/.local/bin
for b in forge cast anvil; do mv x/$b ~/.local/bin/arc-$b; done
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc && source ~/.bashrc
arc-forge --version
```

### 2. Clone and install

```bash
git clone --recurse-submodules <repo-url> verdict && cd verdict
pnpm install
cp .env.example .env      # then fill in the keys (see below)
```

### 3. Test the contract (WSL)

```bash
cd contracts && arc-forge test            # add --network arc to apply Arc EVM rules
```

### 4. Fund the testnet wallets

Get testnet USDC from https://faucet.circle.com (Arc Testnet) for the deployer (gas + pot funds)
and the resolver (gas for `resolve`).

### 5. Deploy (WSL)

```bash
./contracts/deploy.sh      # writes deployments/5042002.json
```

### 6. Web app (local)

```bash
pnpm --filter @verdict/web dev    # http://localhost:3000
```

## Deploying the web app to Vercel

The web app is deployed from `web/` with Vercel's Git integration: every push to `main` updates
production, every other branch gets a preview deployment.

1. Push this repo to GitHub (or GitLab/Bitbucket).
2. In the Vercel dashboard: **Add New… → Project → Import** the repository.
3. **Root Directory: `web`**. Framework preset: Next.js (auto-detected). Leave build/install
   commands at their defaults; Vercel detects pnpm from the root `pnpm-lock.yaml`.
4. Add the environment variables listed below (Production + Preview), then **Deploy**.

CLI alternative (after the project exists):

```bash
npm i -g vercel@latest
vercel login
vercel link            # run in the repo root, select the project
vercel env pull web/.env.local   # optional: pull env for local dev
vercel deploy          # preview;  vercel deploy --prod  for production
```

### Environment variables

Only values safe for the browser use the `NEXT_PUBLIC_` prefix. Private keys and API keys are set
**only** in the host's environment settings, never with `NEXT_PUBLIC_`, never committed.

| Variable | Where | Secret | Purpose |
|---|---|---|---|
| `ARC_RPC_URL` | relay, contracts | no | Arc RPC |
| `ARC_CHAIN_ID` | relay | no | `5042002` |
| `USDC_ADDRESS` | relay, contracts | no | USDC ERC-20 |
| `DEPLOYER_PRIVATE_KEY` | local only | **yes** | deploy + e2e funder |
| `RESOLVER_PRIVATE_KEY` | relay host | **yes** | signs outcomes, submits `resolve` |
| `GRACE_PERIOD_SECONDS` | contracts | no | constructor arg (default 3600) |
| `NEXT_PUBLIC_CHAIN_ID` | web (Vercel) | no | `5042002` |
| `NEXT_PUBLIC_RPC_URL` | web (Vercel) | no | Arc RPC for browser reads |
| `NEXT_PUBLIC_VAULT_ADDRESS` | web (Vercel) | no | deployed vault |
| `NEXT_PUBLIC_API_URL` | web (Vercel) | no | relay REST API base URL |

(The relay's own variables, e.g. database URL and QuickNode token, are added once the hosting
decision is made.)
