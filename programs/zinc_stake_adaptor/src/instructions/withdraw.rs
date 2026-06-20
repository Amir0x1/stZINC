use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::AdaptorError;
use crate::zinc;

/// Account order is FIXED by the vault program for `withdraw_strategy` /
/// `direct_withdraw_strategy`:
///   [vault_strategy_auth (signer), strategy, vault_asset_mint,
///    vault_strategy_asset_ata, asset_token_program, ...remaining]
/// Withdraw is a pure `unstake`, so it only needs the ZINC stake/unstake accounts
/// (no claim/config/player_profile/reward accounts).
#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// vault_strategy_auth — signs the inner ZINC `unstake` (signature propagated).
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: opaque per-strategy handle owned by the vault.
    pub strategy: UncheckedAccount<'info>,

    #[account(mut, address = ZINC_MINT @ AdaptorError::InvalidAssetMint)]
    pub vault_asset_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Strategy-owned ZINC ATA — destination for the unstaked principal. The vault
    /// sweeps it to idle (manager withdraw) or delivers it to the user (direct withdraw).
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

    /// CHECK: validated by address (required by zinc `unstake`).
    #[account(address = ASSOCIATED_TOKEN_PROGRAM)]
    pub associated_token_program: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

/// Unstake `amount` ZINC principal straight from the zinc pool back into the
/// strategy ATA, and report the remaining position value (= remaining principal).
pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<u64> {
    if amount > 0 {
        let a = &ctx.accounts;
        zinc::unstake(
            &a.zinc_program,
            &a.authority.to_account_info(),
            &a.zinc_treasury,
            &a.vault_asset_mint.to_account_info(),
            &a.zinc_stake_position,
            &a.zinc_staking_token_account,
            &a.vault_strategy_asset_ata.to_account_info(),
            &a.associated_token_program,
            &a.asset_token_program.to_account_info(),
            &a.system_program.to_account_info(),
            amount,
        )?;
    }

    zinc::read_stake_balance(&ctx.accounts.zinc_stake_position)
}
