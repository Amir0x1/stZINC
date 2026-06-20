/**
 * harvest-fees.ts — ADMIN/MANAGER. Pays out the vault's accrued fees as stZINC
 * (LP) shares to the manager / admin / protocol-admin LP ATAs (Voltr `harvest_fee`).
 *
 * Fees accrue into vault state as `accumulatedLp*Fees` whenever NAV is recomputed
 * (deposits, withdraws, keeper refresh). This script mints those accumulated
 * shares out to the recipients' ATAs. The admin can then redeem the stZINC for
 * ZINC like any other holder (`user-direct-withdraw`).
 *
 * `harvest_fee` carries no system/ATA program, so the recipient LP ATAs must
 * already exist — we create them idempotently first (admin pays the small rent).
 *
 *   npm run harvest-fees
 */
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from "@solana-program/token";
import {
  fetchProtocol,
  fetchVault,
  findProtocolPda,
  getHarvestFeeInstructionAsync,
} from "@voltr/vault-sdk";
import { KEYPAIRS, LP_MINT, TOKEN_PROGRAM, VAULT } from "../config.js";
import { fromBaseUnits } from "../lib/amount.js";
import { readTokenAmount } from "../lib/reads.js";
import { getRpc, loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const harvester = await loadSigner(KEYPAIRS.admin);
  const rpc = getRpc();

  const vault = await fetchVault(rpc, VAULT);
  const vaultManager = vault.data.manager;
  const vaultAdmin = vault.data.admin;

  const [protocolPda] = await findProtocolPda();
  const protocol = await fetchProtocol(rpc, protocolPda);
  const protocolAdmin = protocol.data.admin;

  const s = vault.data.feeState;
  console.log("accrued LP fees (stZINC):");
  console.log("  manager :", fromBaseUnits(s.accumulatedLpManagerFees));
  console.log("  admin   :", fromBaseUnits(s.accumulatedLpAdminFees));
  console.log("  protocol:", fromBaseUnits(s.accumulatedLpProtocolFees));

  const total =
    s.accumulatedLpManagerFees +
    s.accumulatedLpAdminFees +
    s.accumulatedLpProtocolFees;
  if (total === 0n) {
    console.log("nothing to harvest — all accrued fees are 0.");
    return;
  }

  // harvest_fee can't create ATAs; ensure each recipient's LP ATA exists.
  const owners = [...new Set([vaultAdmin, vaultManager, protocolAdmin])];
  const ataIxs = await Promise.all(
    owners.map((owner) =>
      getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: harvester,
        owner,
        mint: LP_MINT,
        tokenProgram: TOKEN_PROGRAM,
      }),
    ),
  );

  const [adminLpAta] = await findAssociatedTokenPda({
    owner: vaultAdmin,
    mint: LP_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });
  const before = await readTokenAmount(rpc, adminLpAta);

  const harvestIx = await getHarvestFeeInstructionAsync({
    harvester,
    vaultManager,
    vaultAdmin,
    protocolAdmin,
    vault: VAULT,
    // protocol, vaultLpMint, vaultLpMintAuth, recipient ATAs and lpTokenProgram
    // are all derived by the SDK resolver.
  });

  const sig = await sendTx([...ataIxs, harvestIx], {
    feePayer: harvester,
    computeUnitLimit: 400_000,
    priorityMicroLamports: 20_000,
  });

  const after = await readTokenAmount(rpc, adminLpAta);
  console.log(
    `harvested. admin LP ATA +${fromBaseUnits(after - before)} stZINC (now ${fromBaseUnits(after)}). tx:`,
    sig,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
