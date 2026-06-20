/**
 * init-strategy.ts — MANAGER (payer = ADMIN). Initializes the single zinc-staking
 * strategy on the vault and ensures the strategy's ZINC ATA exists.
 *
 *   npm run init-strategy
 */
import { getCreateAssociatedTokenIdempotentInstructionAsync } from "@solana-program/token";
import { getInitializeStrategyInstructionAsync } from "@voltr/vault-sdk";
import { ADAPTOR_PROGRAM, KEYPAIRS, STRATEGY, TOKEN_PROGRAM, VAULT, ZINC_MINT } from "../config.js";
import { INIT_DISC, deriveZincAccounts } from "../lib/adaptor.js";
import { loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const admin = await loadSigner(KEYPAIRS.admin); // funded payer
  const manager = await loadSigner(KEYPAIRS.manager); // strategy authority
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  // Make sure the strategy-owned ZINC ATA exists (idempotent).
  const createAta = await getCreateAssociatedTokenIdempotentInstructionAsync({
    payer: admin,
    owner: z.vaultStrategyAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const initIx = await getInitializeStrategyInstructionAsync({
    payer: admin,
    manager,
    vault: VAULT,
    strategy: STRATEGY,
    adaptorProgram: ADAPTOR_PROGRAM,
    instructionDiscriminator: INIT_DISC,
    additionalArgs: null,
  });

  console.log("strategy:", STRATEGY);
  console.log("vaultStrategyAuth:", z.vaultStrategyAuth);
  console.log("strategy ZINC ATA:", z.vaultStrategyAssetAta);
  console.log("zinc stake_position:", z.stakePosition);

  const sig = await sendTx([createAta, initIx], { feePayer: admin });
  console.log("initialize_strategy confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
