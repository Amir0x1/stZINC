import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Instruction,
  type KeyPairSigner,
  type TransactionSigner,
} from "@solana/kit";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";

/** Resolve the RPC URL from env, falling back to the local solana CLI config
 *  (keeps the Helius API key out of the repo). */
export function getRpcUrl(): string {
  const fromEnv = process.env.RPC_URL ?? process.env.HELIUS_RPC_URL;
  if (fromEnv) return fromEnv;
  try {
    const cfg = readFileSync(
      join(homedir(), ".config/solana/cli/config.yml"),
      "utf8",
    );
    const m = cfg.match(/json_rpc_url:\s*"?([^"\s]+)"?/);
    if (m) return m[1];
  } catch {
    /* ignore */
  }
  throw new Error("Set RPC_URL env var (mainnet RPC endpoint).");
}

const wsUrl = (http: string) => http.replace(/^http/, "ws");

export function getRpc() {
  return createSolanaRpc(getRpcUrl());
}
export function getRpcSubscriptions() {
  return createSolanaRpcSubscriptions(wsUrl(getRpcUrl()));
}

/** Load a Solana keypair JSON file into a kit signer. */
export async function loadSigner(path: string): Promise<KeyPairSigner> {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(path, "utf8")));
  return createKeyPairSignerFromBytes(bytes);
}

export interface SendOpts {
  feePayer: TransactionSigner;
  computeUnitLimit?: number;
  priorityMicroLamports?: number;
}

/** Build, sign, send and confirm a transaction from a list of instructions. */
export async function sendTx(
  instructions: Instruction[],
  opts: SendOpts,
): Promise<string> {
  const rpc = getRpc();
  const rpcSubscriptions = getRpcSubscriptions();

  const budget: Instruction[] = [];
  budget.push(
    getSetComputeUnitLimitInstruction({ units: opts.computeUnitLimit ?? 400_000 }),
  );
  if (opts.priorityMicroLamports) {
    budget.push(
      getSetComputeUnitPriceInstruction({
        microLamports: opts.priorityMicroLamports,
      }),
    );
  }

  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(opts.feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions([...budget, ...instructions], m),
  );

  const signed = await signTransactionMessageWithSigners(message);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });
  await sendAndConfirm(signed as Parameters<typeof sendAndConfirm>[0], {
    commitment: "confirmed",
  });
  return getSignatureFromTransaction(signed);
}

/** Append an instruction's accounts with extra metas (Voltr strategy remaining accounts). */
export function withRemaining<T extends { accounts?: readonly unknown[] }>(
  ix: T,
  remaining: readonly unknown[],
): T {
  return { ...ix, accounts: [...(ix.accounts ?? []), ...remaining] } as T;
}
