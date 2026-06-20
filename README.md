# stZINC — liquid staked ZINC on Solana

stZINC is a liquid staking token for **ZINC** (`zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi`).
Deposit ZINC, receive **stZINC**; the underlying ZINC is staked into the ZINC staking
pool and the staking yield compounds into the position, so **stZINC only grows in value
vs ZINC**. Redeem back to ZINC at any time, straight out of the staking pool.

It is built on the [Voltr](https://voltr.xyz) vault framework. The vault holds the ZINC
and mints/burns stZINC; a small **custom on-chain adaptor** (this repo) bridges the vault
to the ZINC staking program.

```
                deposit ZINC                 allocate (keeper)            stake
   user ───────────────────────► Voltr vault ──────────────► adaptor ──────────────► ZINC pool
        ◄───────────────────────             ◄──────────────         ◄──────────────
                mint stZINC                  direct withdraw               unstake
```

## How it works

- **Deposit** — `deposit_vault` moves ZINC into the vault and mints stZINC at the current
  NAV. A keeper allocates idle ZINC into the staking pool via `deposit_strategy`, which
  CPIs the adaptor's `deposit` → zinc `stake`.
- **Yield / "grows in value"** — the adaptor reports the staked **principal** as the
  strategy's value. On every `deposit` (including a keeper's zero-amount refresh) the
  adaptor first **claims accrued ZINC yield and re-stakes it**, so principal — and thus the
  stZINC↔ZINC exchange rate — only ever rises. See [Fees](#fees) for the cut taken on yield.
- **Withdraw** — any holder redeems in **one transaction** with Voltr
  `instant_withdraw_strategy`, which CPIs the adaptor's `withdraw` → zinc `unstake`,
  delivering ZINC directly from the pool. No idle buffer, no waiting period, no manager
  step. (Registered once via `initialize_direct_withdraw_strategy`.)

The adaptor reports principal-only (yield folded in by compounding), which keeps
`withdraw` a pure `unstake` that can never under-deliver — accounting stays exact and the
program stays simple.

## Fees

Fees live on the **Voltr vault**, not the adaptor (the adaptor is fee-agnostic). All fees
are configured in basis points and only the **vault admin** can change them — at any time,
on-chain — so `npm run read-fees` is the source of truth for the live values.

Current mainnet config: a **5% (500 bps) admin performance fee**; every other fee
(manager performance, manager/admin management, issuance, redemption, protocol) is **0**.

- **Performance fee** is charged only on *profit* — the rise in ZINC-per-stZINC above the
  vault's **high-water mark** — never on principal or flat TVL, and never twice for the same
  gain. As the adaptor compounds staking yield, the fee is taken on each new gain.
- It's collected as **freshly-minted stZINC** credited to the admin (it accrues into the
  vault's `accumulatedLpAdminFees`), so holders are diluted by exactly the fee and keep the
  rest of the yield. The reported stZINC price already reflects this.
- `npm run read-fees` shows the live fee config and accrued amounts; `npm run harvest-fees`
  mints the accrued fees out to the admin's stZINC ATA (then redeem like any holder). The
  keeper also harvests automatically once accrued fees clear a threshold (see [Keeper](#keeper-production)).
- `npm run set-zero-fees -- --force` wipes **all** fees back to 0 — see [Deploy](#deploy--wire-one-time-mainnet).

## On-chain addresses (mainnet)

| | |
|---|---|
| Adaptor program | `stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP` |
| Voltr vault | `7dejJfjPZwduVQwPjTCb5JSW5RQPEpqcjZHkn1Bqbyz8` |
| stZINC (LP mint) | `s7KwLTVMfGR5JLfykszLo6QEqCnGbVxusjw7diaT5Fv` |
| ZINC mint | `zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi` |
| ZINC staking program | `zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV` |
| Voltr vault program | `vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8` |
| Strategy id (zinc treasury) | `4Ucw8BNkLWBu6gxkQsw3BRG2qRtw5WrG1UxiKpQjScH5` |

## Repository layout

```
programs/zinc_stake_adaptor/   Anchor program (the Voltr adaptor)
  src/lib.rs                   initialize / deposit / withdraw entrypoints
  src/instructions/            account contexts + handlers
  src/zinc.rs                  raw CPI builders into the ZINC staking program
  src/constants.rs             mainnet addresses, discriminators, account offsets
app/                           operational TypeScript (admin/manager + reads)
  src/scripts/                 one script per operation (see below)
web/                           minimal wallet-adapter web UI (deposit / withdraw + live APR)
keeper/                        self-contained bash+node keeper for a cron box
keys/                          keypairs — GITIGNORED, never committed
```

Secrets (`keys/`, `admin-*`, `manager-*`, `*-keypair.json`, `.env`) and the private spec
(`stZINC.md`) are gitignored; everything else is open source.

## Build

```bash
anchor build                                   # builds programs/zinc_stake_adaptor
cd app && npm install && npm run typecheck     # operational scripts
cd ../web && npm install && npm run build      # web UI
```

## Deploy & wire (one-time, mainnet)

The deployer wallet (`keys/admin-*.json`, the vault admin) must hold **~2 SOL** for the
program-data rent.

```bash
anchor deploy                                  # deploys the adaptor; admin = upgrade authority

cd app
npm run add-adaptor          # admin: register the adaptor on the vault
npm run init-strategy        # manager: create the zinc-staking strategy (+ its ZINC ATA)
npm run init-direct-withdraw # admin: register `withdraw` as the user direct-withdraw path
# fees: a 5% (500 bps) admin performance fee is live (see Fees). To run fully fee-free instead:
#   npm run set-zero-fees -- --force   # admin: zero ALL vault fees
```

## Operate

```bash
cd app
npm run deposit-strategy -- 10        # manager: stake 10 idle ZINC into the pool
npm run withdraw-strategy -- 5        # manager: unstake 5 ZINC back to idle (or `all`)
npm run stake-all-idle                # manager: crank NAV + stake ALL idle (skips if no work)
npm run keeper-refresh                # manager: compound yield + refresh NAV only
npm run read-state                    # snapshot: price, staked, idle, yield, supply
npm run read-fees                     # snapshot: live fee config + accrued fees
npm run harvest-fees                  # admin: mint accrued fees out to the admin stZINC ATA

# user flows (USER_KEYPAIR defaults to admin for testing)
npm run user-deposit -- 1             # deposit 1 ZINC -> stZINC
npm run user-direct-withdraw -- all   # redeem stZINC -> ZINC (amount in stZINC, or `all`)
```

RPC: scripts read `RPC_URL` / `HELIUS_RPC_URL`, else the local `solana` CLI config — so the
endpoint (and any API key) stays out of the repo.

## Web UI

```bash
cd web && npm run dev        # http://localhost:5173 — connect any wallet, deposit / redeem
```

Uses the standard Solana **wallet adapter** (Phantom, Solflare, Backpack, … — any
Wallet-Standard wallet, none hardcoded). Paste your own RPC URL in the UI for reliability.

## Keeper (production)

`keeper/` is a self-contained bash + Node keeper for a cron box, signed and fee-paid by a
single manager key. Each run:

1. **Cranks NAV + stakes idle** — one `deposit_strategy(idle)` call compounds staking yield
   (the stZINC price ticks up) and stakes all idle vault ZINC into the zinc pool.
2. **Harvests fees** *(on by default, non-fatal)* — once accrued vault fees clear
   `HARVEST_MIN_STZINC`, a separate `harvest_fee` tx mints them out to the
   admin/manager/protocol stZINC ATAs. Set `HARVEST=0` to disable; a harvest failure is
   logged and never fails the run.

```bash
cd keeper && cp keeper.env.example keeper.env   # set RPC_URL + MANAGER_KEYPAIR (+ optional HARVEST*)
chmod +x keeper.sh && ./keeper.sh               # first run installs deps
# cron: */10 * * * * /opt/stzinc-keeper/keeper.sh >> /opt/stzinc-keeper/keeper.log 2>&1
```

Between a deposit and a redemption the keeper should stake idle ZINC (`deposit-strategy`) so
the redeemed principal comes from the pool. A missed/failed run is harmless — idle ZINC just
waits for the next run, and users can still deposit and redeem meanwhile.

## Adaptor interface (for reference)

The Voltr vault CPIs the adaptor with a fixed account prefix, then our zinc accounts as
remaining accounts. Returns the `u64` position value via `get_return_data`.

| ix | vault op | does | returns |
|---|---|---|---|
| `initialize` | `initialize_strategy` | funds the strategy PDA's rent for zinc accounts | — |
| `deposit(amount)` | `deposit_strategy` | claim+re-stake yield, then `stake(amount)` | staked principal |
| `withdraw(amount)` | `withdraw_strategy` / `instant_withdraw_strategy` | `unstake(amount)` | remaining principal |

## Security & risk

**Program model:**
- Every inner ZINC CPI is signed by the strategy authority (the Voltr `vault_strategy_auth`
  PDA), and **all fund-bearing accounts — the strategy ATA and the stake position — are
  derived from that authority**. All ZINC accounts are validated by PDA seeds under the ZINC
  program, and `vault_asset_mint` is constrained to the ZINC mint. So the adaptor can only
  ever stake the vault's own ZINC into the vault's own position; there is no arbitrary-CPI
  path and no way to route funds elsewhere.
- NAV is reported as staked **principal only**, so it can never over-report — a withdraw is a
  pure `unstake` that cannot under-deliver. Checked math, `reload()` after every CPI before
  reading balances, Token-2022-aware via `InterfaceAccount`/`TokenInterface`.

**Trust assumptions — read before depositing:**
- **Upgradeable program, single-key upgrade authority.** The upgrade authority is the vault
  admin (one keypair); whoever holds it can replace the program with arbitrary logic. Moving
  it to a multisig/timelock (or revoking it) is recommended before treating deposits as
  trustless.
- **External ZINC dependency.** The adaptor hardcodes the ZINC program's instruction
  discriminators and account-layout offsets (`src/constants.rs`), verified against the
  currently deployed ZINC program. If ZINC is upgraded and changes its layout, NAV reads or
  CPIs could break or misreport.
- **No automated test suite yet, and unaudited.** Tested on mainnet only. This software is
  provided as-is, without warranty; **use at your own risk.**

## License

MIT — see [LICENSE](./LICENSE).
