import { address, type Address } from "@solana/kit";

/**
 * All on-chain addresses for the stZINC system. Public, mainnet.
 * (Keypair files and the RPC URL live outside the repo — see lib/solana.ts.)
 */

// ----- Voltr -----
export const VOLTR_VAULT_PROGRAM = address(
  "vVoLTRjQmtFpiYoegx285Ze4gsLJ8ZxgFKVcuvmG1a8",
);
export const VAULT = address("7dejJfjPZwduVQwPjTCb5JSW5RQPEpqcjZHkn1Bqbyz8");
export const LP_MINT = address("s7KwLTVMfGR5JLfykszLo6QEqCnGbVxusjw7diaT5Fv"); // stZINC

// ----- ZINC -----
export const ZINC_PROGRAM = address("zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV");
export const ZINC_MINT = address("zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi");

// ----- SPL -----
export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

/**
 * Our deployed adaptor program id. Override with ADAPTOR_PROGRAM_ID env once the
 * vanity keypair is deployed; the committed default is the working program id.
 */
export const ADAPTOR_PROGRAM: Address = address(
  process.env.ADAPTOR_PROGRAM_ID ?? "stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP",
);

/**
 * The Voltr `strategy` id for this vault's single zinc-staking strategy. We use
 * the ZINC treasury account (the staking pool's core state) as a stable, unique
 * 1:1 handle. The adaptor treats `strategy` as opaque, so the choice only needs
 * to be deterministic and unique per vault.
 */
export const STRATEGY = address("4Ucw8BNkLWBu6gxkQsw3BRG2qRtw5WrG1UxiKpQjScH5");

// ----- ZINC PDA seeds (program = ZINC_PROGRAM) -----
export const ZINC_SEEDS = {
  treasury: ["treasury"],
  config: ["config"],
  stakingTokenAccount: ["treasury", "staking-token-account"],
  stakingRewardTokenAccount: ["treasury", "staking-reward-token-account"],
  stakePosition: (authority: Address) => ["stake-position", authority],
  playerProfile: (authority: Address) => ["player-profile", authority],
} as const;

// Keypair file paths (relative to the app/ working dir). Gitignored.
export const KEYPAIRS = {
  admin: "../keys/admin-armMHMFMrCJ5arvxF24avVXab2bbDaeyu1xXBaPJuzc.json",
  manager: "../keys/manager-zcUGSEQTpZ1J1mxE6GVmjXCkSn59y12Q25q1w6diuTm.json",
};
