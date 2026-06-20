use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::AdaptorError;
use crate::zinc;

/// Account order is FIXED by the vault program for `deposit_strategy`:
///   [vault_strategy_auth (signer), strategy, vault_asset_mint,
///    vault_strategy_asset_ata, asset_token_program, ...remaining]
/// The remaining accounts are the ZINC stake + claim accounts (we compound yield
/// on every deposit, so the claim path's accounts are always present).
#[derive(Accounts)]
pub struct Deposit<'info> {
    /// vault_strategy_auth — signs the inner ZINC CPIs (signature propagated from the vault).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: opaque per-strategy handle owned by the vault.
    pub strategy: UncheckedAccount<'info>,

    /// The vault underlying asset mint — must be ZINC.
    #[account(mut, address = ZINC_MINT @ AdaptorError::InvalidAssetMint)]
    pub vault_asset_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Strategy-owned ZINC ATA. The vault has already moved `amount` ZINC into it
    /// before this CPI. It is the source for `stake` and the destination for
    /// claimed yield.
    #[account(
        mut,
        associated_token::mint = vault_asset_mint,
        associated_token::authority = authority,
        associated_token::token_program = asset_token_program,
    )]
    pub vault_strategy_asset_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub asset_token_program: Interface<'info, TokenInterface>,

    // ----- ZINC remaining accounts -----
    /// CHECK: validated by address; the program we CPI into.
    #[account(address = ZINC_PROGRAM)]
    pub zinc_program: UncheckedAccount<'info>,

    /// CHECK: ZINC treasury PDA, validated by seeds under the ZINC program.
    #[account(mut, seeds = [SEED_TREASURY], bump, seeds::program = ZINC_PROGRAM)]
    pub zinc_treasury: UncheckedAccount<'info>,

    /// CHECK: ZINC config PDA, validated by seeds under the ZINC program.
    #[account(seeds = [SEED_CONFIG], bump, seeds::program = ZINC_PROGRAM)]
    pub zinc_config: UncheckedAccount<'info>,

    /// CHECK: per-authority stake position PDA, validated by seeds under the ZINC program.
    #[account(
        mut,
        seeds = [SEED_STAKE_POSITION, authority.key().as_ref()],
        bump,
        seeds::program = ZINC_PROGRAM
    )]
    pub zinc_stake_position: UncheckedAccount<'info>,

    /// CHECK: shared staking vault token account PDA, validated by seeds.
    #[account(
        mut,
        seeds = [SEED_TREASURY, SEED_STAKING_TOKEN_ACCOUNT],
        bump,
        seeds::program = ZINC_PROGRAM
    )]
    pub zinc_staking_token_account: UncheckedAccount<'info>,

    /// CHECK: shared staking reward vault token account PDA, validated by seeds.
    #[account(
        mut,
        seeds = [SEED_TREASURY, SEED_STAKING_REWARD_TOKEN_ACCOUNT],
        bump,
        seeds::program = ZINC_PROGRAM
    )]
    pub zinc_staking_reward_token_account: UncheckedAccount<'info>,

    /// CHECK: per-authority player profile PDA, validated by seeds. Created by the
    /// ZINC program on first `claim_staking_yield`.
    #[account(
        mut,
        seeds = [SEED_PLAYER_PROFILE, authority.key().as_ref()],
        bump,
        seeds::program = ZINC_PROGRAM
    )]
    pub zinc_player_profile: UncheckedAccount<'info>,

    /// CHECK: validated by address.
    #[account(address = ASSOCIATED_TOKEN_PROGRAM)]
    pub associated_token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Compound accrued yield, then stake the deposited `amount`, and report the
/// strategy's position value (= staked ZINC principal) to the vault.
pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<u64> {
    let a = &ctx.accounts;

    // 1) Compound: if the position already holds yield, claim it into the strategy
    //    ATA so it gets re-staked together with the new deposit. Skipped on the
    //    first-ever deposit (no position) and when there is nothing to claim.
    if zinc::position_has_yield(&a.zinc_treasury, &a.zinc_stake_position)? {
        zinc::claim_staking_yield(
            &a.zinc_program,
            &a.authority.to_account_info(),
            &a.zinc_config,
            &a.zinc_treasury,
            &a.vault_asset_mint.to_account_info(),
            &a.zinc_stake_position,
            &a.zinc_player_profile,
            &a.zinc_staking_reward_token_account,
            &a.vault_strategy_asset_ata.to_account_info(),
            &a.associated_token_program,
            &a.asset_token_program.to_account_info(),
            &a.system_program.to_account_info(),
        )?;
    }

    // 2) Stake the full strategy ATA balance: the just-deposited `amount` plus any
    //    yield we just claimed. This is the "direct deposit into the zinc pool".
    ctx.accounts.vault_strategy_asset_ata.reload()?;
    let to_stake = ctx.accounts.vault_strategy_asset_ata.amount;
    require!(to_stake >= amount, AdaptorError::InsufficientDepositedFunds);

    if to_stake > 0 {
        let a = &ctx.accounts;
        zinc::stake(
            &a.zinc_program,
            &a.authority.to_account_info(),
            &a.zinc_treasury,
            &a.vault_asset_mint.to_account_info(),
            &a.vault_strategy_asset_ata.to_account_info(),
            &a.zinc_stake_position,
            &a.zinc_staking_token_account,
            &a.asset_token_program.to_account_info(),
            &a.system_program.to_account_info(),
            to_stake,
        )?;
    }

    // 3) Position value (underlying ZINC terms) = staked principal. All realized
    //    yield is compounded into principal, so this only ever grows.
    zinc::read_stake_balance(&ctx.accounts.zinc_stake_position)
}
