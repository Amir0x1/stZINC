/**
 * user-deposit.ts — USER. Deposits ZINC into the vault and receives stZINC.
 * (The staking into the zinc pool happens when the manager/keeper allocates idle
 * → strategy; the user gets stZINC immediately at the current NAV.)
 *
 *   USER_KEYPAIR=/path/to/user.json npm run user-deposit -- <ZINC_AMOUNT>
 */
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { getDepositVaultInstructionAsync } from "@voltr/vault-sdk";
import { KEYPAIRS, LP_MINT, TOKEN_PROGRAM, VAULT, ZINC_MINT } from "../config.js";
import { toBaseUnits } from "../lib/amount.js";
import { loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const amount = toBaseUnits(process.argv[2] ?? "0");
  const user = await loadSigner(process.env.USER_KEYPAIR ?? KEYPAIRS.admin);

  // Ensure the user's stZINC ATA exists to receive LP.
  const createLpAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: user,
    owner: user.address,
    mint: LP_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const depositIx = await getDepositVaultInstructionAsync({
    userTransferAuthority: user,
    vault: VAULT,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    amount,
  });

  const sig = await sendTx([createLpAta, depositIx], {
    feePayer: user,
    priorityMicroLamports: 20_000,
  });
  console.log(`deposited ${process.argv[2]} ZINC -> stZINC. tx:`, sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
