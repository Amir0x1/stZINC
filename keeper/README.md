# stZINC keeper

A self-contained keeper for the stZINC vault. Each run does:

1. **Crank NAV** — the adaptor claims accrued ZINC staking yield, re-stakes it
   (compounding into principal), and reports the fresh position value to the vault,
   so the stZINC↔ZINC price ticks up.
2. **Deposit idle** — stakes all idle vault ZINC into the zinc staking pool.
3. **Harvest fees** *(optional)* — mints accrued vault fees out to the
   admin/manager/protocol stZINC ATAs (Voltr `harvest_fee`).

Steps 1–2 are the single Voltr `deposit_strategy(idleAmount)` call (idle `0` →
crank only). Step 3 is a separate `harvest_fee` tx, sent only when the accrued
fees clear `HARVEST_MIN_STZINC` so dust runs don't waste a transaction. It is
**non-fatal**: a harvest hiccup is logged and never fails the run. Disable it
with `HARVEST=0`. The manager merely cranks the harvest — the fee shares go to the
on-chain admin/manager/protocol recipients regardless of who signs.

## Files

```
keeper.sh            cron entrypoint (bash)
keeper.mjs           the worker (self-contained Node ESM)
package.json         deps
keeper.env.example   config template
```

## Setup on your Linux node

```bash
# 1. copy this folder onto the box, e.g. /opt/stzinc-keeper, then:
cd /opt/stzinc-keeper
cp keeper.env.example keeper.env

# 2. put the MANAGER keypair on the box (chmod 600) and point keeper.env at it:
#    MANAGER_KEYPAIR=/opt/stzinc-keeper/manager.json
#    RPC_URL=https://your-mainnet-rpc
chmod 600 manager.json keeper.env

# 3. first run (installs deps, executes once):
chmod +x keeper.sh
./keeper.sh
```

Requirements: Node 18+ and npm. The **manager** wallet must hold a little SOL for
fees (it signs *and* pays). ~0.00002 SOL/run → ~0.3 SOL lasts months at 10-min cadence.

## Cron (every 10 minutes)

```cron
*/10 * * * * /opt/stzinc-keeper/keeper.sh >> /opt/stzinc-keeper/keeper.log 2>&1
```

## Security

- The manager key can **only** stake/unstake the vault's own ZINC (the on-chain
  adaptor hard-constrains the mint and PDAs) and crank `harvest_fee` — which routes
  fees to the on-chain admin/manager/protocol recipients no matter who signs. It
  cannot move funds anywhere else. Safe to run unattended on a locked-down box.
- `keeper.env`, `*.log`, and any `*.json` keypair are gitignored. Keep the keypair
  `chmod 600` and the box access-controlled.
- A missed/failed run is harmless: idle ZINC just waits for the next run; users can
  still deposit and redeem meanwhile.
