#!/usr/bin/env bash
# Deploy VerdictVault to Arc testnet. Run from WSL/Linux/macOS: ./contracts/deploy.sh
# Reads secrets from ../.env (never printed).
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
FORGE=$(command -v arc-forge || command -v forge)

set -a; . ../.env; set +a
: "${ARC_RPC_URL:?missing}" "${DEPLOYER_PRIVATE_KEY:?missing}" "${USDC_ADDRESS:?missing}"

"$FORGE" script script/Deploy.s.sol:Deploy \
  --rpc-url "$ARC_RPC_URL" \
  --broadcast \
  --slow \
  "$@"
