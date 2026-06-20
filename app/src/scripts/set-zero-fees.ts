/**
 * set-zero-fees.ts — ADMIN, optional. Zeroes EVERY vault fee (performance,
 * management, redemption, issuance) in one shot. One field per update instruction.
 *
 * DESTRUCTIVE: this wipes any fee currently configured — including the live
 * 10 bps admin performance fee. It does not ask; it overwrites all six fields
 * with 0. Run `npm run read-fees` first to see what you'd be clearing, and pass
 * `--force` to actually send (a bare run just prints the current fees and aborts).
 *
 *   npm run read-fees                 # see current fees
 *   npm run set-zero-fees -- --force  # zero them all
 */
import { AccountRole, getU16Encoder, type AccountMeta } from "@solana/kit";
import {
  VaultConfigField,
  fetchVault,
  findVaultLpMintPda,
  getUpdateVaultConfigInstructionAsync,
} from "@voltr/vault-sdk";
import { KEYPAIRS, VAULT } from "../config.js";
import { getRpc, loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const admin = await loadSigner(KEYPAIRS.admin);

  // Guard: show what's about to be wiped, and require --force to proceed.
  const f = (await fetchVault(getRpc(), VAULT)).data.feeConfiguration;
  console.log("current fees (bps):", {
    managerPerformanceFee: f.managerPerformanceFee,
    adminPerformanceFee: f.adminPerformanceFee,
    managerManagementFee: f.managerManagementFee,
    adminManagementFee: f.adminManagementFee,
    redemptionFee: f.redemptionFee,
    issuanceFee: f.issuanceFee,
  });
  if (!process.argv.includes("--force")) {
    console.log(
      "refusing to zero fees without --force. re-run with: npm run set-zero-fees -- --force",
    );
    return;
  }

  const [vaultLpMint] = await findVaultLpMintPda({ vault: VAULT });
  const zero = new Uint8Array(getU16Encoder().encode(0));

  const simpleFields = [
    VaultConfigField.ManagerPerformanceFee,
    VaultConfigField.AdminPerformanceFee,
    VaultConfigField.RedemptionFee,
    VaultConfigField.IssuanceFee,
  ];
  const mgmtFields = [
    VaultConfigField.ManagerManagementFee,
    VaultConfigField.AdminManagementFee,
  ];

  const ixs = [];
  for (const field of simpleFields) {
    ixs.push(
      await getUpdateVaultConfigInstructionAsync({ admin, vault: VAULT, field, data: zero }),
    );
  }
  // Management-fee updates require the LP mint appended as a read-only account.
  for (const field of mgmtFields) {
    const ix = await getUpdateVaultConfigInstructionAsync({
      admin,
      vault: VAULT,
      field,
      data: zero,
    });
    const lpMeta: AccountMeta = { address: vaultLpMint, role: AccountRole.READONLY };
    ixs.push({ ...ix, accounts: [...(ix.accounts ?? []), lpMeta] });
  }

  const sig = await sendTx(ixs, { feePayer: admin });
  console.log("all vault fees set to 0. tx:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
