/**
 * user-direct-withdraw.ts — USER. Redeems stZINC for ZINC in ONE transaction,
 * straight out of the zinc staking pool (Voltr `instant_withdraw_strategy` → our
 * adaptor's `withdraw` → zinc `unstake`). No waiting period, no idle buffer needed.
 *
 *   USER_KEYPAIR=/path/to/user.json npm run user-direct-withdraw -- <stZINC_AMOUNT | all>
 */
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { getInstantWithdrawStrategyInstructionAsync } from "@voltr/vault-sdk";
import {
  ADAPTOR_PROGRAM,
  KEYPAIRS,
  STRATEGY,
  TOKEN_PROGRAM,
  VAULT,
  ZINC_MINT,
} from "../config.js";
import { deriveZincAccounts, withdrawRemaining } from "../lib/adaptor.js";
import { toBaseUnits } from "../lib/amount.js";
import { loadSigner, sendTx, withRemaining } from "../lib/solana.js";

async function main() {
  const arg = process.argv[2] ?? "all";
  const isWithdrawAll = arg === "all";
  const amount = isWithdrawAll ? 0n : toBaseUnits(arg); // stZINC (LP) base units

  const user = await loadSigner(process.env.USER_KEYPAIR ?? KEYPAIRS.admin);
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  // Ensure the user's ZINC ATA exists to receive the redeemed principal.
  const createAssetAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: user,
    owner: user.address,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const ix = await getInstantWithdrawStrategyInstructionAsync({
    userTransferAuthority: user,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    adaptorProgram: ADAPTOR_PROGRAM,
    assetTokenProgram: TOKEN_PROGRAM,
    amount,
    isAmountInLp: true, // amount is in stZINC (LP) units
    isWithdrawAll,
    userArgs: null,
  });

  const full = withRemaining(ix, withdrawRemaining(z));
  const sig = await sendTx([createAssetAta, full], {
    feePayer: user,
    computeUnitLimit: 400_000,
    priorityMicroLamports: 20_000,
  });
  console.log(`redeemed ${arg} stZINC -> ZINC. tx:`, sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
