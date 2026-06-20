/**
 * init-direct-withdraw.ts — ADMIN, one-time. Registers the adaptor's `withdraw`
 * instruction as the user-facing direct-withdraw path for the strategy, so any
 * holder can redeem ZINC straight out of the zinc pool (no waiting period, no
 * manager step) via `direct_withdraw_strategy`.
 *
 *   npm run init-direct-withdraw
 */
import { getInitializeDirectWithdrawStrategyInstructionAsync } from "@voltr/vault-sdk";
import { ADAPTOR_PROGRAM, KEYPAIRS, STRATEGY, VAULT } from "../config.js";
import { WITHDRAW_DISC } from "../lib/adaptor.js";
import { loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const admin = await loadSigner(KEYPAIRS.admin);

  const ix = await getInitializeDirectWithdrawStrategyInstructionAsync({
    payer: admin,
    admin,
    vault: VAULT,
    strategy: STRATEGY,
    adaptorProgram: ADAPTOR_PROGRAM,
    instructionDiscriminator: WITHDRAW_DISC, // vault CPIs adaptor.withdraw(amount)
    additionalArgs: null,
    allowUserArgs: false, // the vault computes the amount; users pass nothing
  });

  const sig = await sendTx([ix], { feePayer: admin });
  console.log("initialize_direct_withdraw_strategy confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
