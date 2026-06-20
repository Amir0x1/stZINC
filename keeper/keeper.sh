#!/usr/bin/env bash
#
# stZINC keeper — cron entrypoint for a Linux node.
# Cranks the vault NAV and stakes all idle ZINC into the zinc pool, in one tx.
#
# Setup (once):
#   cp keeper.env.example keeper.env   && edit it (RPC_URL + MANAGER_KEYPAIR path)
#   ./keeper.sh                         # first run installs deps
# Cron (every 10 min):
#   */10 * * * * /opt/stzinc-keeper/keeper.sh >> /opt/stzinc-keeper/keeper.log 2>&1
#
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Load config (RPC_URL, MANAGER_KEYPAIR / MANAGER_SECRET_KEY, PRIORITY_MICROLAMPORTS).
if [ -f "$DIR/keeper.env" ]; then
  set -a; . "$DIR/keeper.env"; set +a
fi

command -v node >/dev/null 2>&1 || { echo "[keeper] node is required (v18+)"; exit 1; }

# Install SDK deps on first run.
if [ ! -d "$DIR/node_modules" ]; then
  echo "[keeper] installing dependencies…"
  npm install --silent --no-audit --no-fund
fi

exec node "$DIR/keeper.mjs"
