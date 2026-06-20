/**
 * deposit-strategy.ts — MANAGER (fee payer = ADMIN). Allocates idle ZINC from the
 * vault into the zinc staking pool (and compounds any accrued yield first).
 *
 *   npm run deposit-strategy -- <ZINC_AMOUNT>      e.g. 1.25
 */
import {
  getDepositStrategyInstructionAsync,
} from "@voltr/vault-sdk";
import {
  ADAPTOR_PROGRAM,
  KEYPAIRS,
  STRATEGY,
  TOKEN_PROGRAM,
  VAULT,
  ZINC_MINT,
} from "../config.js";
import { DEPOSIT_DISC, depositRemaining, deriveZincAccounts } from "../lib/adaptor.js";
import { toBaseUnits } from "../lib/amount.js";
import { loadSigner, sendTx, withRemaining } from "../lib/solana.js";

async function main() {
  const amountArg = process.argv[2] ?? "0";
  const amount = toBaseUnits(amountArg);

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
    amount,
    instructionDiscriminator: DEPOSIT_DISC,
    additionalArgs: null,
  });

  const full = withRemaining(ix, depositRemaining(z));
  console.log(`deposit_strategy amount=${amountArg} ZINC (${amount} raw)`);
  const sig = await sendTx([full], {
    feePayer: admin,
    computeUnitLimit: 600_000,
    priorityMicroLamports: 20_000,
  });
  console.log("confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
