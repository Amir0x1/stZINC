// stZINC keeper — self-contained. Run by keeper.sh on a cron.
//
// One `deposit_strategy(idle)` call does BOTH jobs:
//   1) cranks NAV  — the adaptor claims + re-stakes accrued ZINC yield and returns
//      the fresh position value, which the vault records (price ticks up).
//   2) deposits idle — stakes all idle vault ZINC into the zinc staking pool.
//
// Signed + paid by a single MANAGER key. No websocket needed (poll confirmation).

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  address,
  AccountRole,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createTransactionMessage,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
} from "@solana-program/token";
import {
  fetchProtocol,
  fetchVault,
  findProtocolPda,
  findVaultAssetIdleAuthPda,
  findVaultStrategyAuthPda,
  getDepositStrategyInstructionAsync,
  getHarvestFeeInstructionAsync,
} from "@voltr/vault-sdk";

// ---- public mainnet addresses (stZINC) ----
const VAULT = address("7dejJfjPZwduVQwPjTCb5JSW5RQPEpqcjZHkn1Bqbyz8");
const ZINC_MINT = address("zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi");
const LP_MINT = address("s7KwLTVMfGR5JLfykszLo6QEqCnGbVxusjw7diaT5Fv"); // stZINC
const ADAPTOR_PROGRAM = address("stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP");
const STRATEGY = address("4Ucw8BNkLWBu6gxkQsw3BRG2qRtw5WrG1UxiKpQjScH5"); // zinc treasury
const ZINC_PROGRAM = address("zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV");
const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

const RPC_URL = process.env.RPC_URL || process.env.HELIUS_RPC_URL;
if (!RPC_URL) fail("set RPC_URL (mainnet RPC endpoint) in keeper.env");
const PRIORITY = BigInt(process.env.PRIORITY_MICROLAMPORTS || "20000");

// Fee harvesting (opt-out): after the crank, mint accrued fees out to the
// admin/manager/protocol stZINC ATAs, but only once enough has accrued to be
// worth a tx. Set HARVEST=0 to disable; HARVEST_MIN_STZINC to tune the floor.
const HARVEST_ENABLED = !["0", "false", "no", "off"].includes(
  (process.env.HARVEST ?? "1").trim().toLowerCase(),
);
const stZincToUnits = (s) => {
  const [w, f = ""] = String(s).trim().split(".");
  return BigInt(w || "0") * 1_000_000_000n + BigInt((f + "000000000").slice(0, 9) || "0");
};
const HARVEST_MIN = stZincToUnits(process.env.HARVEST_MIN_STZINC || "0.01");
const fmt = (raw) => (Number(raw) / 1e9).toString();

const log = (m) => console.log(`[keeper ${new Date().toISOString()}] ${m}`);
function fail(m) {
  console.error(`[keeper] ERROR: ${m}`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addrEnc = getAddressEncoder();
const isAddr = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
const seed = (s) => (isAddr(s) ? new Uint8Array(addrEnc.encode(s)) : new TextEncoder().encode(s));
const pda = async (seeds) =>
  (await getProgramDerivedAddress({ programAddress: ZINC_PROGRAM, seeds: seeds.map(seed) }))[0];

function loadManager() {
  const inline = process.env.MANAGER_SECRET_KEY;
  const path = process.env.MANAGER_KEYPAIR;
  let bytes;
  if (inline) bytes = Uint8Array.from(JSON.parse(inline));
  else if (path) bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  else fail("set MANAGER_KEYPAIR (path) or MANAGER_SECRET_KEY (inline JSON) in keeper.env");
  return createKeyPairSignerFromBytes(bytes);
}

async function readTokenAmount(rpc, acc) {
  const info = await rpc.getAccountInfo(acc, { encoding: "base64" }).send();
  const d = info.value?.data?.[0];
  if (!d) return 0n;
  const b = Buffer.from(d, "base64");
  return b.length >= 72 ? b.readBigUInt64LE(64) : 0n;
}

/** Build (CU budget + ixs), sign with the manager, send and confirm. */
async function buildSignSend(rpc, manager, instructions, cuLimit) {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(manager, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getSetComputeUnitLimitInstruction({ units: cuLimit }),
          getSetComputeUnitPriceInstruction({ microLamports: PRIORITY }),
          ...instructions,
        ],
        m,
      ),
  );
  const signed = await signTransactionMessageWithSigners(message);
  return sendAndConfirm(rpc, signed);
}

async function sendAndConfirm(rpc, signed) {
  const sig = getSignatureFromTransaction(signed);
  const wire = getBase64EncodedWireTransaction(signed);
  await rpc
    .sendTransaction(wire, { encoding: "base64", maxRetries: 5n, preflightCommitment: "confirmed" })
    .send();
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    await sleep(2500);
    const { value } = await rpc.getSignatureStatuses([sig]).send();
    const st = value[0];
    if (st?.err) throw new Error("tx failed: " + JSON.stringify(st.err));
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return sig;
  }
  throw new Error("confirmation timeout: " + sig);
}

async function main() {
  const rpc = createSolanaRpc(RPC_URL);
  const manager = await loadManager();

  const [vaultStrategyAuth] = await findVaultStrategyAuthPda({ vault: VAULT, strategy: STRATEGY });
  const [idleAuth] = await findVaultAssetIdleAuthPda({ vault: VAULT });
  const [idleAta] = await findAssociatedTokenPda({
    owner: idleAuth,
    mint: ZINC_MINT,
    tokenProgram: TOKEN_PROGRAM,
  });

  const idle = await readTokenAmount(rpc, idleAta);
  log(`manager=${manager.address} idle=${Number(idle) / 1e9} ZINC`);

  // adaptor `Deposit` remaining accounts, in struct order after the fixed prefix.
  const treasury = await pda(["treasury"]);
  const config = await pda(["config"]);
  const stakePosition = await pda(["stake-position", vaultStrategyAuth]);
  const stakingTokenAccount = await pda(["treasury", "staking-token-account"]);
  const stakingRewardTokenAccount = await pda(["treasury", "staking-reward-token-account"]);
  const playerProfile = await pda(["player-profile", vaultStrategyAuth]);
  const W = (a) => ({ address: a, role: AccountRole.WRITABLE });
  const R = (a) => ({ address: a, role: AccountRole.READONLY });
  const remaining = [
    R(ZINC_PROGRAM),
    W(treasury),
    R(config),
    W(stakePosition),
    W(stakingTokenAccount),
    W(stakingRewardTokenAccount),
    W(playerProfile),
    R(ATA_PROGRAM),
    R(SYSTEM_PROGRAM),
  ];

  const depositDisc = new Uint8Array(createHash("sha256").update("global:deposit").digest().subarray(0, 8));
  const ix = await getDepositStrategyInstructionAsync({
    manager,
    vault: VAULT,
    strategy: STRATEGY,
    vaultAssetMint: ZINC_MINT,
    assetTokenProgram: TOKEN_PROGRAM,
    adaptorProgram: ADAPTOR_PROGRAM,
    amount: idle, // stake all idle (0 → crank only)
    instructionDiscriminator: depositDisc,
    additionalArgs: null,
  });
  const full = { ...ix, accounts: [...(ix.accounts ?? []), ...remaining] };

  const sig = await buildSignSend(rpc, manager, [full], 600_000);

  log(`✓ step 1 — NAV cranked (yield compounded + price refreshed)`);
  log(`✓ step 2 — deposited ${Number(idle) / 1e9} idle ZINC into the zinc stake pool`);
  log(`✓ tx https://solscan.io/tx/${sig}`);

  // Step 3 (optional) — harvest accrued vault fees. Non-fatal: the crank above
  // has already succeeded, so a harvest hiccup must never fail the keeper run.
  if (HARVEST_ENABLED) {
    try {
      await maybeHarvest(rpc, manager);
    } catch (e) {
      log(`⚠ harvest skipped (non-fatal): ${e?.message ?? e}`);
    }
  }
}

// Read accrued fees (post-crank) and, if past the floor, mint them out to the
// admin/manager/protocol stZINC ATAs via Voltr `harvest_fee`. The manager just
// cranks it; the shares go to the configured recipients regardless of signer.
async function maybeHarvest(rpc, manager) {
  const vault = await fetchVault(rpc, VAULT);
  const fs = vault.data.feeState;
  const total =
    fs.accumulatedLpManagerFees + fs.accumulatedLpAdminFees + fs.accumulatedLpProtocolFees;
  log(
    `accrued fees (stZINC): admin=${fmt(fs.accumulatedLpAdminFees)} ` +
      `manager=${fmt(fs.accumulatedLpManagerFees)} protocol=${fmt(fs.accumulatedLpProtocolFees)}`,
  );
  if (total < HARVEST_MIN) {
    log(`harvest skipped — accrued ${fmt(total)} < min ${fmt(HARVEST_MIN)} stZINC`);
    return;
  }

  const vaultManager = vault.data.manager;
  const vaultAdmin = vault.data.admin;
  const [protocolPda] = await findProtocolPda();
  const protocolAdmin = (await fetchProtocol(rpc, protocolPda)).data.admin;

  // harvest_fee carries no system/ATA program, so recipient LP ATAs must exist.
  const owners = [...new Set([vaultAdmin, vaultManager, protocolAdmin])];
  const ataIxs = await Promise.all(
    owners.map((owner) =>
      getCreateAssociatedTokenIdempotentInstructionAsync({
        payer: manager,
        owner,
        mint: LP_MINT,
        tokenProgram: TOKEN_PROGRAM,
      }),
    ),
  );
  const harvestIx = await getHarvestFeeInstructionAsync({
    harvester: manager,
    vaultManager,
    vaultAdmin,
    protocolAdmin,
    vault: VAULT,
  });

  const sig = await buildSignSend(rpc, manager, [...ataIxs, harvestIx], 250_000);
  log(`✓ step 3 — harvested ${fmt(total)} stZINC of fees to admin/manager/protocol ATAs`);
  log(`✓ tx https://solscan.io/tx/${sig}`);
}

main().catch((e) => fail(e?.message ?? String(e)));
