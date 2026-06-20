//! Hard-coded mainnet addresses, instruction discriminators, and account layout
//! offsets for the ZINC staking program. These are immutable facts of the
//! deployed `zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV` program.

use anchor_lang::prelude::*;

/// The ZINC staking program we CPI into.
pub const ZINC_PROGRAM: Pubkey = pubkey!("zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV");

/// The ZINC SPL mint. This is also the Voltr vault's underlying asset mint, so
/// every `deposit`/`withdraw` validates `vault_asset_mint == ZINC_MINT`.
pub const ZINC_MINT: Pubkey = pubkey!("zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi");

/// SPL Associated Token Account program (required by zinc `unstake` / `claim_staking_yield`).
pub const ASSOCIATED_TOKEN_PROGRAM: Pubkey =
    pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

// ----- ZINC PDA seeds (program = ZINC_PROGRAM) -----
pub const SEED_TREASURY: &[u8] = b"treasury";
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_STAKE_POSITION: &[u8] = b"stake-position";
pub const SEED_STAKING_TOKEN_ACCOUNT: &[u8] = b"staking-token-account";
pub const SEED_STAKING_REWARD_TOKEN_ACCOUNT: &[u8] = b"staking-reward-token-account";
pub const SEED_PLAYER_PROFILE: &[u8] = b"player-profile";

// ----- ZINC instruction discriminators (Anchor sha256("global:<name>")[..8]) -----
pub const ZINC_STAKE_IX: [u8; 8] = [206, 176, 202, 18, 200, 209, 179, 108];
pub const ZINC_UNSTAKE_IX: [u8; 8] = [90, 95, 107, 42, 205, 124, 50, 225];
pub const ZINC_CLAIM_STAKING_YIELD_IX: [u8; 8] = [105, 22, 90, 204, 157, 145, 17, 231];

// ----- StakePosition account layout (82 bytes total) -----
// disc[8] | authority:Pubkey[32] | initialized:bool[1] | bump:u8[1]
//   | balance:u64 | rewardsFactorCheckpoint:u128 | claimableRewards:u64 | lifetimeRewards:u64
pub const STAKE_POSITION_LEN: usize = 82;
pub const STAKE_POS_OFF_BALANCE: usize = 42;
pub const STAKE_POS_OFF_REWARDS_CHECKPOINT: usize = 50;
pub const STAKE_POS_OFF_CLAIMABLE: usize = 66;

// ----- Treasury account layout (staking-relevant prefix) -----
// disc[8] | bump:u8 | zincMint:Pubkey[32] | curveAdminTokenAccount[32] | bonanzaTokenAccount[32]
//   | stockpileTokenAccount[32] | roundZincRewardTokenAccount[32] | stockpileSolVault[32]
//   | buybackSolVault[32] | totalZincMinted:u64 | totalZincMelted:u64 | bonanzaPot:u64
//   | totalStaked:u64 | stakingRewardsFactor:u128 | ...
pub const TREASURY_OFF_STAKING_REWARDS_FACTOR: usize = 265;
pub const TREASURY_MIN_LEN: usize = TREASURY_OFF_STAKING_REWARDS_FACTOR + 16;

/// Lamports we seed the vault-strategy authority PDA with at `initialize`, so it
/// can pay rent for the zinc `stake_position` (82 bytes) and `player_profile`
/// accounts it creates on first stake/claim. Generous buffer; one-time per strategy.
pub const STRATEGY_AUTH_RENT_FUNDING: u64 = 12_000_000; // 0.012 SOL
