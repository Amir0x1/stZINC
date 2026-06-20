use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};

use crate::constants::STRATEGY_AUTH_RENT_FUNDING;

/// Account order is FIXED by the vault program for `initialize_strategy`:
///   [payer, vault_strategy_auth (signer), strategy, system_program, ...remaining]
#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The vault's payer (a real funded wallet). Funds the strategy authority's
    /// rent buffer for the zinc accounts created lazily on first stake/claim.
    #[account(mut)]
    pub payer: Signer<'info>,

    /// vault_strategy_auth — the per-strategy PDA that will own the staked ZINC
    /// position and sign every CPI into the ZINC program. It must hold a little
    /// SOL so the ZINC program can create its `stake_position` / `player_profile`
    /// (funded by this account as the staking signer).
    #[account(mut)]
    pub authority: SystemAccount<'info>,

    /// CHECK: opaque per-strategy handle owned by the vault; nothing to validate here.
    pub strategy: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    // Top up the strategy authority so it can pay rent for the zinc accounts it
    // creates as the staking signer. Only transfer the shortfall (idempotent if
    // the strategy is re-initialized).
    let current = ctx.accounts.authority.lamports();
    if current < STRATEGY_AUTH_RENT_FUNDING {
        let needed = STRATEGY_AUTH_RENT_FUNDING - current;
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.payer.to_account_info(),
                    to: ctx.accounts.authority.to_account_info(),
                },
            ),
            needed,
        )?;
    }
    Ok(())
}
