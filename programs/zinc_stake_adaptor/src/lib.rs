//! # zinc_stake_adaptor
//!
//! A minimal [Voltr](https://voltr.xyz) adaptor that bridges a Voltr vault to the
//! ZINC staking pool, enabling the **stZINC** liquid staking token.
//!
//! Fund flow:
//! ```text
//! user --ZINC--> Voltr vault --(deposit_strategy CPI)--> THIS ADAPTOR --(stake CPI)--> ZINC pool
//! user <-stZINC- Voltr vault
//!
//! user --(direct_withdraw_strategy)--> Voltr vault --(CPI)--> THIS ADAPTOR --(unstake CPI)--> ZINC pool --ZINC--> user
//! ```
//!
//! Design goals (kept deliberately simple):
//! - **Direct deposit / direct withdraw** straight into/out of the zinc pool; no
//!   idle buffer, users redeem any time via Voltr's `direct_withdraw_strategy`.
//! - **NAV only grows**: position value reported to the vault is the staked ZINC
//!   *principal*. Staking yield is compounded into principal on every deposit
//!   (and via a keeper `deposit_strategy(0)` refresh), so the stZINC↔ZINC rate
//!   only ever rises and the vault's accounting is never overstated.

use anchor_lang::prelude::*;

pub mod constants;
pub mod error;
pub mod instructions;
pub mod zinc;

use instructions::*;

declare_id!("stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP");

#[program]
pub mod zinc_stake_adaptor {
    use super::*;

    /// Called by the vault during `initialize_strategy`. Seeds the strategy
    /// authority PDA with rent so the ZINC program can lazily create its
    /// `stake_position` / `player_profile` accounts on first stake/claim.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::handler(ctx)
    }

    /// Called by the vault during `deposit_strategy`. Compounds accrued yield and
    /// stakes the deposited ZINC. Returns current position value (staked principal).
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<u64> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Called by the vault during `withdraw_strategy` and `direct_withdraw_strategy`.
    /// Unstakes `amount` ZINC principal back to the vault. Returns remaining
    /// position value (remaining principal).
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<u64> {
        instructions::withdraw::handler(ctx, amount)
    }
}
