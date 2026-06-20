/**
 * withdraw-strategy.ts — MANAGER (fee payer = ADMIN). Pulls ZINC principal out of
 * the zinc pool back into vault idle. Amount is clamped to the staked balance so
 * the unstake can never request more than exists.
 *
 *   npm run withdraw-strategy -- <ZINC_AMOUNT | all>
 */
import { getWithdrawStrategyInstructionAsync } from "@voltr/vault-sdk";
import {
  ADAPTOR_PROGRAM,
  KEYPAIRS,
  STRATEGY,
  TOKEN_PROGRAM,
  VAULT,
  ZINC_MINT,
} from "../config.js";
import { WITHDRAW_DISC, deriveZincAccounts, withdrawRemaining } from "../lib/adaptor.js";
import { fromBaseUnits, toBaseUnits } from "../lib/amount.js";
import { readStakePosition } from "../lib/reads.js";
import { getRpc, loadSigner, sendTx, withRemaining } from "../lib/solana.js";

async function main() {
  const arg = process.argv[2] ?? "all";
  const admin = await loadSigner(KEYPAIRS.admin);
  const manager = await loadSigner(KEYPAIRS.manager);
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  const pos = await readStakePosition(getRpc(), z.stakePosition);
  const requested = arg === "all" ? pos.balance : toBaseUnits(arg);
  const amount = requested > pos.balance ? pos.balance : requested;
  if (amount === 0n) {
    console.log("nothing staked to withdraw.");
    return;
  }

  const ix = await getWithdrawStrategyInstructionAsync({
    manager,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    adaptorProgram: ADAPTOR_PROGRAM,
    amount,
    instructionDiscriminator: WITHDRAW_DISC,
    additionalArgs: null,
  });

  const full = withRemaining(ix, withdrawRemaining(z));
  console.log(`withdraw_strategy amount=${fromBaseUnits(amount)} ZINC (${amount} raw)`);
  const sig = await sendTx([full], {
    feePayer: admin,
    computeUnitLimit: 400_000,
    priorityMicroLamports: 20_000,
  });
  console.log("confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
