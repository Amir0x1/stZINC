import {
  type Address,
  createNoopSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Instruction,
} from "@solana/kit";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from "@solana-program/token";
import {
  findVaultStrategyAuthPda,
  getDepositVaultInstructionAsync,
  getInstantWithdrawStrategyInstructionAsync,
} from "@voltr/vault-sdk";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import {
  ADAPTOR_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  LP_MINT,
  STRATEGY,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  VAULT,
  ZINC_MINT,
  ZINC_PROGRAM,
} from "./config";

const addrEnc = getAddressEncoder();
const isB58Addr = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const seedBytes = (s: string | Address): Uint8Array =>
  isB58Addr(s) ? new Uint8Array(addrEnc.encode(s as Address)) : new TextEncoder().encode(s);

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
  stakePosition: Address;
  stakingTokenAccount: Address;
}

export async function deriveZincAccounts(): Promise<ZincAccounts> {
  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({ vault: VAULT, strategy: STRATEGY });
  const [vaultStrategyAssetAta] = await findAssociatedTokenPda({
    owner: vaultStrategyAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });
  return {
    vaultStrategyAuth,
    vaultStrategyAssetAta,
    treasury: await zincPda(["treasury"]),
    stakePosition: await zincPda(["stake-position", vaultStrategyAuth]),
    stakingTokenAccount: await zincPda(["treasury", "staking-token-account"]),
  };
}

/** kit AccountRole bit flags: bit0 = writable, bit1 = signer. */
function toWeb3Ix(ix: Instruction): TransactionInstruction {
  const accounts = (ix.accounts ?? []) as unknown as { address: string; role: number }[];
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: accounts.map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner: (a.role & 0b10) !== 0,
      isWritable: (a.role & 0b01) !== 0,
    })),
    data: Buffer.from((ix.data ?? new Uint8Array()) as Uint8Array),
  });
}

const WRITABLE = 1;
const READONLY = 0;
const meta = (a: Address, role: number) => ({ address: a, role });

export async function buildDepositIxs(
  wallet: string,
  amountRaw: bigint,
): Promise<TransactionInstruction[]> {
  const user = createNoopSigner(wallet as Address);
  const createLpAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: user,
    owner: wallet as Address,
    mint: LP_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });
  const deposit = await getDepositVaultInstructionAsync({
    userTransferAuthority: user,
    vault: VAULT,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    amount: amountRaw,
  });
  return [createLpAta, deposit].map(toWeb3Ix);
}

export async function buildWithdrawIxs(
  wallet: string,
  lpAmountRaw: bigint,
  isWithdrawAll: boolean,
): Promise<TransactionInstruction[]> {
  const user = createNoopSigner(wallet as Address);
  const z = await deriveZincAccounts();

  const createAssetAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: user,
    owner: wallet as Address,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const withdraw = await getInstantWithdrawStrategyInstructionAsync({
    userTransferAuthority: user,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    adaptorProgram: ADAPTOR_PROGRAM,
    assetTokenProgram: TOKEN_PROGRAM,
    amount: lpAmountRaw,
    isAmountInLp: true,
    isWithdrawAll,
    userArgs: null,
  });

  // Remaining accounts = adaptor `Withdraw` struct order after the fixed prefix.
  const withdrawRemaining = [
    meta(ZINC_PROGRAM, READONLY),
    meta(z.treasury, WRITABLE),
    meta(z.stakePosition, WRITABLE),
    meta(z.stakingTokenAccount, WRITABLE),
    meta(ASSOCIATED_TOKEN_PROGRAM, READONLY),
    meta(SYSTEM_PROGRAM, READONLY),
  ];
  const withdrawFull = {
    ...withdraw,
    accounts: [...(withdraw.accounts ?? []), ...withdrawRemaining],
  } as Instruction;

  return [toWeb3Ix(createAssetAta), toWeb3Ix(withdrawFull)];
}
