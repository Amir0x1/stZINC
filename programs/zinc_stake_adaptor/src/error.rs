use anchor_lang::prelude::*;

#[error_code]
pub enum AdaptorError {
    #[msg("vault_asset_mint does not match the ZINC mint")]
    InvalidAssetMint,
    #[msg("stake position account data has an unexpected size")]
    BadStakePositionData,
    #[msg("treasury account data has an unexpected size")]
    BadTreasuryData,
    #[msg("arithmetic overflow")]
    MathOverflow,
    #[msg("strategy asset ATA holds fewer tokens than the deposit amount")]
    InsufficientDepositedFunds,
}
