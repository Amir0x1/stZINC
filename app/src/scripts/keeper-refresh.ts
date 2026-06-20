/**
 * keeper-refresh.ts — MANAGER (fee payer = ADMIN). Run on a schedule (e.g. hourly).
 * Calls `deposit_strategy(0)`, which makes the adaptor claim accrued ZINC yield,
 * re-stake it (compounding into principal), and report the fresh position value
 * back to the vault — so the stZINC↔ZINC exchange rate ticks up.
 *
 *   npm run keeper-refresh
 */
import { getDepositStrategyInstructionAsync } from "@voltr/vault-sdk";
import {
  ADAPTOR_PROGRAM,
  KEYPAIRS,
  STRATEGY,
  TOKEN_PROGRAM,
  VAULT,
  ZINC_MINT,
} from "../config.js";
import { DEPOSIT_DISC, depositRemaining, deriveZincAccounts } from "../lib/adaptor.js";
import { loadSigner, sendTx, withRemaining } from "../lib/solana.js";

async function main() {
  const admin = await loadSigner(KEYPAIRS.admin);
  const manager = await loadSigner(KEYPAIRS.manager);
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  const ix = await getDepositStrategyInstructionAsync({
    manager,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    adaptorProgram: ADAPTOR_PROGRAM,
    amount: 0n, // compound + refresh only
    instructionDiscriminator: DEPOSIT_DISC,
    additionalArgs: null,
  });

  const full = withRemaining(ix, depositRemaining(z));
  const sig = await sendTx([full], {
    feePayer: admin,
    computeUnitLimit: 600_000,
    priorityMicroLamports: 20_000,
  });
  console.log("keeper refresh (compound) confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
