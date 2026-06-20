/**
 * add-adaptor.ts — ADMIN, one-time. Registers the zinc-stake adaptor program on
 * the stZINC vault so strategies can be initialized against it.
 *
 *   npm run add-adaptor
 */
import { getAddAdaptorInstructionAsync } from "@voltr/vault-sdk";
import { ADAPTOR_PROGRAM, KEYPAIRS, VAULT } from "../config.js";
import { loadSigner, sendTx } from "../lib/solana.js";

async function main() {
  const admin = await loadSigner(KEYPAIRS.admin);

  const ix = await getAddAdaptorInstructionAsync({
    payer: admin,
    admin,
    vault: VAULT,
    adaptorProgram: ADAPTOR_PROGRAM,
  });

  const sig = await sendTx([ix], { feePayer: admin });
  console.log("add_adaptor confirmed:", sig);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
