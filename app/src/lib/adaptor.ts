import { createHash } from "node:crypto";
import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { findVaultStrategyAuthPda } from "@voltr/vault-sdk";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  ZINC_MINT,
  ZINC_PROGRAM,
} from "../config.js";

/** Anchor instruction discriminator = sha256("global:<name>")[..8]. */
export function anchorDiscriminator(name: string): Uint8Array {
  return new Uint8Array(
    createHash("sha256").update(`global:${name}`).digest().subarray(0, 8),
  );
}

export const INIT_DISC = anchorDiscriminator("initialize");
export const DEPOSIT_DISC = anchorDiscriminator("deposit");
export const WITHDRAW_DISC = anchorDiscriminator("withdraw");

const addrEnc = getAddressEncoder();
const seedBytes = (s: string | Address): Uint8Array =>
  s.length <= 32 && !s.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)
    ? new TextEncoder().encode(s)
    : new Uint8Array(addrEnc.encode(s as Address));

/** Derive a PDA under the ZINC program from a mix of string / address seeds. */
async function zincPda(seeds: (string | Address)[]): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: ZINC_PROGRAM,
    seeds: seeds.map(seedBytes),
  });
  return pda;
}

export interface ZincAccounts {
  vaultStrategyAuth: Address;
  vaultStrategyAssetAta: Address;
  treasury: Address;
  config: Address;
  stakePosition: Address;
  stakingTokenAccount: Address;
  stakingRewardTokenAccount: Address;
  playerProfile: Address;
}

/** Derive every ZINC account the adaptor needs for a given Voltr (vault, strategy). */
export async function deriveZincAccounts(
  vault: Address,
  strategy: Address,
): Promise<ZincAccounts> {
  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({ vault, strategy });
  const [vaultStrategyAssetAta] = await findAssociatedTokenPda({
    owner: vaultStrategyAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });
  return {
    vaultStrategyAuth,
    vaultStrategyAssetAta,
    treasury: await zincPda(["treasury"]),
    config: await zincPda(["config"]),
    stakePosition: await zincPda(["stake-position", vaultStrategyAuth]),
    stakingTokenAccount: await zincPda(["treasury", "staking-token-account"]),
    stakingRewardTokenAccount: await zincPda([
      "treasury",
      "staking-reward-token-account",
    ]),
    playerProfile: await zincPda(["player-profile", vaultStrategyAuth]),
  };
}

const w = (a: Address): AccountMeta => ({ address: a, role: AccountRole.WRITABLE });
const r = (a: Address): AccountMeta => ({ address: a, role: AccountRole.READONLY });

/**
 * Remaining accounts for `deposit_strategy`, in the EXACT order of the adaptor's
 * `Deposit` struct fields after the fixed vault prefix.
 */
export function depositRemaining(z: ZincAccounts): AccountMeta[] {
  return [
    r(ZINC_PROGRAM),
    w(z.treasury),
    r(z.config),
    w(z.stakePosition),
    w(z.stakingTokenAccount),
    w(z.stakingRewardTokenAccount),
    w(z.playerProfile),
    r(ASSOCIATED_TOKEN_PROGRAM),
    r(SYSTEM_PROGRAM),
  ];
}

/**
 * Remaining accounts for `withdraw_strategy` / `direct_withdraw_strategy`, in the
 * EXACT order of the adaptor's `Withdraw` struct fields after the fixed prefix.
 */
export function withdrawRemaining(z: ZincAccounts): AccountMeta[] {
  return [
    r(ZINC_PROGRAM),
    w(z.treasury),
    w(z.stakePosition),
    w(z.stakingTokenAccount),
    r(ASSOCIATED_TOKEN_PROGRAM),
    r(SYSTEM_PROGRAM),
  ];
}
