/**
 * read-fees.ts — read-only dump of the live vault's fee configuration,
 * fee-update timestamps, and accumulated (harvested-but-unclaimed) fees.
 *
 *   npm run read-fees
 */
import { fetchVault } from "@voltr/vault-sdk";
import { VAULT } from "../config.js";
import { getRpc } from "../lib/solana.js";

async function main() {
  const rpc = getRpc();
  const vault = await fetchVault(rpc, VAULT);
  const f = vault.data.feeConfiguration;
  const u = vault.data.feeUpdate;
  const s = vault.data.feeState;

  console.log("vault   :", VAULT);
  console.log("admin   :", vault.data.admin);
  console.log("manager :", vault.data.manager);
  console.log("──────── fee configuration (bps) ────────");
  console.log("managerPerformanceFee :", f.managerPerformanceFee);
  console.log("adminPerformanceFee   :", f.adminPerformanceFee);
  console.log("managerManagementFee  :", f.managerManagementFee);
  console.log("adminManagementFee    :", f.adminManagementFee);
  console.log("redemptionFee         :", f.redemptionFee);
  console.log("issuanceFee           :", f.issuanceFee);
  console.log("protocolPerformanceFee:", f.protocolPerformanceFee);
  console.log("protocolManagementFee :", f.protocolManagementFee);
  console.log("──────── fee update ts ────────");
  console.log("lastPerformanceFeeUpdateTs:", u.lastPerformanceFeeUpdateTs.toString());
  console.log("lastManagementFeeUpdateTs :", u.lastManagementFeeUpdateTs.toString());
  console.log("──────── accumulated LP fees (stZINC base units) ────────");
  console.log("accumulatedLpManagerFees :", s.accumulatedLpManagerFees.toString());
  console.log("accumulatedLpAdminFees   :", s.accumulatedLpAdminFees.toString());
  console.log("accumulatedLpProtocolFees:", s.accumulatedLpProtocolFees.toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
