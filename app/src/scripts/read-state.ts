/**
 * read-state.ts — read-only snapshot of the stZINC vault + zinc-staking strategy.
 *
 *   npm run read-state
 */
import { findVaultAssetIdleAuthPda } from "@voltr/vault-sdk";
import { findAssociatedTokenPda } from "@solana-program/token";
import { LP_MINT, STRATEGY, TOKEN_PROGRAM, VAULT, ZINC_MINT } from "../config.js";
import { deriveZincAccounts } from "../lib/adaptor.js";
import { fromBaseUnits } from "../lib/amount.js";
import { readStakePosition, readTokenAmount } from "../lib/reads.js";
import { getRpc } from "../lib/solana.js";

async function main() {
  const rpc = getRpc();
  const z = await deriveZincAccounts(VAULT, STRATEGY);

  const [idleAuth] = await findVaultAssetIdleAuthPda({ vault: VAULT });
  const [idleAta] = await findAssociatedTokenPda({
    owner: idleAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const [idle, stratAta, pos, lpSupplyRes] = await Promise.all([
    readTokenAmount(rpc, idleAta),
    readTokenAmount(rpc, z.vaultStrategyAssetAta),
    readStakePosition(rpc, z.stakePosition),
    rpc.getTokenSupply(LP_MINT).send(),
  ]);

  const staked = pos.balance;
  const claimable = pos.claimableRewards;
  // NAV = idle + staked principal (claimable yield is realized into principal on compound)
  const totalAssets = idle + staked;
  const lpSupply = BigInt(lpSupplyRes.value.amount);
  const priceStr =
    lpSupply === 0n
      ? "n/a (no stZINC minted yet — first deposit mints 1:1)"
      : (Number(totalAssets) / Number(lpSupply)).toFixed(9);

  console.log("stZINC vault state");
  console.log("──────────────────────────────────────────────");
  console.log("vault                :", VAULT);
  console.log("adaptor              :", "stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP");
  console.log("strategy (zinc pool) :", STRATEGY);
  console.log("vaultStrategyAuth    :", z.vaultStrategyAuth);
  console.log("zinc stake_position  :", z.stakePosition);
  console.log("──────────────────────────────────────────────");
  console.log("idle ZINC            :", fromBaseUnits(idle));
  console.log("staked ZINC          :", fromBaseUnits(staked));
  console.log("strategy ATA ZINC    :", fromBaseUnits(stratAta));
  console.log("unclaimed yield      :", fromBaseUnits(claimable));
  console.log("lifetime yield       :", fromBaseUnits(pos.lifetimeRewards));
  console.log("──────────────────────────────────────────────");
  console.log("total assets (ZINC)  :", fromBaseUnits(totalAssets));
  console.log("stZINC supply        :", fromBaseUnits(lpSupply));
  console.log("price (ZINC / stZINC):", priceStr);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
