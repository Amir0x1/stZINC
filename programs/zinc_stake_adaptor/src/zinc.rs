//! Raw CPI builders into the ZINC staking program and small readers for its
//! account layouts. We build instructions by hand (there is no Rust client crate
//! for ZINC) using the discriminators + account orders verified from the
//! `@sphalerite-foundry/zinc-ts-sdk` generated client.
//!
//! All inner CPIs are signed by `authority` (the Voltr `vault_strategy_auth` PDA).
//! That account is already a signer in our instruction context (the vault forwards
//! its signature via `invoke_signed`), so a plain `invoke` propagates it — we never
//! need the adaptor's own seeds to sign the ZINC calls.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke,
};

use crate::constants::*;
use crate::error::AdaptorError;

fn read_u64(data: &[u8], off: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(off..off + 8)
        .ok_or(AdaptorError::BadStakePositionData)?
        .try_into()
        .map_err(|_| AdaptorError::BadStakePositionData)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_u128(data: &[u8], off: usize, err: AdaptorError) -> Result<u128> {
    let bytes: [u8; 16] = data
        .get(off..off + 16)
        .ok_or(err)?
        .try_into()
        .map_err(|_| err)?;
    Ok(u128::from_le_bytes(bytes))
}

/// Current staked ZINC principal of the position. Returns 0 if the position
/// account does not exist yet (first deposit).
pub fn read_stake_balance(stake_position: &AccountInfo) -> Result<u64> {
    let data = stake_position.try_borrow_data()?;
    if data.len() < STAKE_POSITION_LEN {
        // Account not yet created (empty) -> no principal staked.
        return Ok(0);
    }
    read_u64(&data, STAKE_POS_OFF_BALANCE)
}

/// True if this position has unrealized staking yield worth claiming:
/// either already-settled `claimableRewards > 0`, or the global treasury reward
/// factor has advanced past the position's checkpoint (pending, not-yet-settled).
/// Conservatively returns false if either account is missing/short so we never
/// attempt a zero-value claim.
pub fn position_has_yield(treasury: &AccountInfo, stake_position: &AccountInfo) -> Result<bool> {
    let pos = stake_position.try_borrow_data()?;
    if pos.len() < STAKE_POSITION_LEN {
        return Ok(false);
    }
    let claimable = read_u64(&pos, STAKE_POS_OFF_CLAIMABLE)?;
    if claimable > 0 {
        return Ok(true);
    }
    let checkpoint = read_u128(&pos, STAKE_POS_OFF_REWARDS_CHECKPOINT, AdaptorError::BadStakePositionData)?;

    let tre = treasury.try_borrow_data()?;
    if tre.len() < TREASURY_MIN_LEN {
        return Ok(false);
    }
    let factor = read_u128(&tre, TREASURY_OFF_STAKING_REWARDS_FACTOR, AdaptorError::BadTreasuryData)?;
    Ok(factor > checkpoint)
}

fn ix_data(disc: [u8; 8], amount: Option<u64>) -> Vec<u8> {
    let mut data = Vec::with_capacity(16);
    data.extend_from_slice(&disc);
    if let Some(a) = amount {
        data.extend_from_slice(&a.to_le_bytes());
    }
    data
}

/// CPI: zinc `stake(amount)` — moves `amount` ZINC from the strategy ATA into the
/// shared staking vault and creates/updates the per-authority stake position.
#[allow(clippy::too_many_arguments)]
pub fn stake<'info>(
    zinc_program: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    zinc_mint: &AccountInfo<'info>,
    signer_zinc_ata: &AccountInfo<'info>,
    stake_position: &AccountInfo<'info>,
    staking_token_account: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let ix = Instruction {
        program_id: ZINC_PROGRAM,
        accounts: vec![
            AccountMeta::new(*authority.key, true),
            AccountMeta::new(*treasury.key, false),
            AccountMeta::new_readonly(*zinc_mint.key, false),
            AccountMeta::new(*signer_zinc_ata.key, false),
            AccountMeta::new(*stake_position.key, false),
            AccountMeta::new(*staking_token_account.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data(ZINC_STAKE_IX, Some(amount)),
    };
    invoke(
        &ix,
        &[
            authority.clone(),
            treasury.clone(),
            zinc_mint.clone(),
            signer_zinc_ata.clone(),
            stake_position.clone(),
            staking_token_account.clone(),
            token_program.clone(),
            system_program.clone(),
            zinc_program.clone(),
        ],
    )?;
    Ok(())
}

/// CPI: zinc `unstake(amount)` — moves `amount` of staked ZINC principal back out
/// of the staking vault into the strategy ATA.
#[allow(clippy::too_many_arguments)]
pub fn unstake<'info>(
    zinc_program: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    zinc_mint: &AccountInfo<'info>,
    stake_position: &AccountInfo<'info>,
    staking_token_account: &AccountInfo<'info>,
    signer_zinc_ata: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let ix = Instruction {
        program_id: ZINC_PROGRAM,
        accounts: vec![
            AccountMeta::new(*authority.key, true),
            AccountMeta::new(*treasury.key, false),
            AccountMeta::new_readonly(*zinc_mint.key, false),
            AccountMeta::new(*stake_position.key, false),
            AccountMeta::new(*staking_token_account.key, false),
            AccountMeta::new(*signer_zinc_ata.key, false),
            AccountMeta::new_readonly(*associated_token_program.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data(ZINC_UNSTAKE_IX, Some(amount)),
    };
    invoke(
        &ix,
        &[
            authority.clone(),
            treasury.clone(),
            zinc_mint.clone(),
            stake_position.clone(),
            staking_token_account.clone(),
            signer_zinc_ata.clone(),
            associated_token_program.clone(),
            token_program.clone(),
            system_program.clone(),
            zinc_program.clone(),
        ],
    )?;
    Ok(())
}

/// CPI: zinc `claim_staking_yield()` — settles + pays the position's full accrued
/// ZINC yield from the reward vault into the strategy ATA (creating the player
/// profile on first use). No args.
#[allow(clippy::too_many_arguments)]
pub fn claim_staking_yield<'info>(
    zinc_program: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    config: &AccountInfo<'info>,
    treasury: &AccountInfo<'info>,
    zinc_mint: &AccountInfo<'info>,
    stake_position: &AccountInfo<'info>,
    player_profile: &AccountInfo<'info>,
    staking_reward_token_account: &AccountInfo<'info>,
    signer_zinc_ata: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let ix = Instruction {
        program_id: ZINC_PROGRAM,
        accounts: vec![
            AccountMeta::new(*authority.key, true),
            AccountMeta::new_readonly(*config.key, false),
            AccountMeta::new(*treasury.key, false),
            AccountMeta::new_readonly(*zinc_mint.key, false),
            AccountMeta::new(*stake_position.key, false),
            AccountMeta::new(*player_profile.key, false),
            AccountMeta::new(*staking_reward_token_account.key, false),
            AccountMeta::new(*signer_zinc_ata.key, false),
            AccountMeta::new_readonly(*associated_token_program.key, false),
            AccountMeta::new_readonly(*token_program.key, false),
            AccountMeta::new_readonly(*system_program.key, false),
        ],
        data: ix_data(ZINC_CLAIM_STAKING_YIELD_IX, None),
    };
    invoke(
        &ix,
        &[
            authority.clone(),
            config.clone(),
            treasury.clone(),
            zinc_mint.clone(),
            stake_position.clone(),
            player_profile.clone(),
            staking_reward_token_account.clone(),
            signer_zinc_ata.clone(),
            associated_token_program.clone(),
            token_program.clone(),
            system_program.clone(),
            zinc_program.clone(),
        ],
    )?;
    Ok(())
}
