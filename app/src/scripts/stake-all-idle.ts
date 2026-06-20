/**
 * stake-all-idle.ts — MANAGER (fee payer = ADMIN). The keeper action: stake ALL
 * idle ZINC into the zinc pool and compound accrued yield, in one tx. Skips (no
 * tx, no fee) when there is nothing to do — no idle ZINC and no pending yield.
 *
 *   npm run stake-all-idle
 */
import { findAssociatedTokenPda } from "@solana-program/token";
import { findVaultAssetIdleAuthPda, getDepositStrategyInstructionAsync } from "@voltr/vault-sdk";
import { ADAPTOR_PROGRAM, KEYPAIRS, STRATEGY, TOKEN_PROGRAM, VAULT, ZINC_MINT } from "../config.js";
import { DEPOSIT_DISC, depositRemaining, deriveZincAccounts } from "../lib/adaptor.js";
import { fromBaseUnits } from "../lib/amount.js";
import { readStakePosition, readTokenAmount, readTreasuryRewardsFactor } from "../lib/reads.js";
import { getRpc, loadSigner, sendTx, withRemaining } from "../lib/solana.js";

async function main() {
  const rpc = getRpc();
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  const [idleAuth] = await findVaultAssetIdleAuthPda({ vault: VAULT });
  const [idleAta] = await findAssociatedTokenPda({
    owner: idleAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const [idle, pos, factor] = await Promise.all([
    readTokenAmount(rpc, idleAta),
    readStakePosition(rpc, z.stakePosition),
    readTreasuryRewardsFactor(rpc, z.treasury),
  ]);

  const pendingYield = pos.claimableRewards > 0n || factor > pos.rewardsFactorCheckpoint;
  if (idle === 0n && !pendingYield) {
    console.log("nothing to do — idle 0, no pending yield. skipping.");
    return;
  }

  const admin = await loadSigner(KEYPAIRS.admin);
  const manager = await loadSigner(KEYPAIRS.manager);

  const ix = await getDepositStrategyInstructionAsync({
    manager,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    adaptorProgram: ADAPTOR_PROGRAM,
    amount: idle, // stake everything idle (0 is fine → compound-only)
    instructionDiscriminator: DEPOSIT_DISC,
    additionalArgs: null,
  });

  const sig = await sendTx([withRemaining(ix, depositRemaining(z))], {
    feePayer: admin,
    computeUnitLimit: 600_000,
    priorityMicroLamports: 20_000,
  });
  console.log(`staked ${fromBaseUnits(idle)} idle ZINC + compounded yield. tx: ${sig}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
