import { address } from "@solana/kit";

export const VAULT = address("7dejJfjPZwduVQwPjTCb5JSW5RQPEpqcjZHkn1Bqbyz8");
export const LP_MINT = address("s7KwLTVMfGR5JLfykszLo6QEqCnGbVxusjw7diaT5Fv"); // stZINC
export const ZINC_MINT = address("zinc155BS4mSPk8GXQj4R5hkVDQXcW253pTYq5SGyfi");
export const ZINC_PROGRAM = address("zincUFpnqYwdYMc1KfH6rKcBvbcdVtHKckKhvrHLDsV");
export const ADAPTOR_PROGRAM = address("stZC6zrjzED3DUknVZy1ZX1HRpVVU4gJpNsz8Aey6aP");
export const STRATEGY = address("4Ucw8BNkLWBu6gxkQsw3BRG2qRtw5WrG1UxiKpQjScH5"); // zinc treasury

export const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM = address(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM = address("11111111111111111111111111111111");

export const DECIMALS = 9;
// RPC comes from a gitignored web/.env (VITE_RPC_URL) so the endpoint/API key never
// lands in the repo; falls back to public mainnet. Override anytime in the UI field.
export const DEFAULT_RPC =
  import.meta.env.VITE_RPC_URL ?? "https://api.mainnet-beta.solana.com";
