import { type Address } from "@solana/kit";

type Rpc = ReturnType<typeof import("./solana.js").getRpc>;

/** Decoded ZINC stake position (82-byte account). */
export interface StakePosition {
  exists: boolean;
  balance: bigint; // staked ZINC principal (raw)
  rewardsFactorCheckpoint: bigint; // u128 reward factor last seen by this position
  claimableRewards: bigint; // settled, unclaimed ZINC yield (raw)
  lifetimeRewards: bigint;
}

function readU64(b: Buffer, off: number): bigint {
  return b.readBigUInt64LE(off);
}

function readU128(b: Buffer, off: number): bigint {
  return b.readBigUInt64LE(off) + (b.readBigUInt64LE(off + 8) << 64n);
}

/** Treasury global cumulative staking reward-per-share accumulator (u128 @ 265). */
export async function readTreasuryRewardsFactor(rpc: Rpc, treasury: Address): Promise<bigint> {
  const res = await rpc.getAccountInfo(treasury, { encoding: "base64" }).send();
  const data = res.value?.data?.[0];
  if (!data) return 0n;
  const b = Buffer.from(data, "base64");
  if (b.length < 281) return 0n;
  return readU128(b, 265);
}

/** Fetch + decode a ZINC stake position. Returns zeros if the account is empty. */
export async function readStakePosition(
  rpc: Rpc,
  stakePosition: Address,
): Promise<StakePosition> {
  const res = await rpc
    .getAccountInfo(stakePosition, { encoding: "base64" })
    .send();
  const empty: StakePosition = {
    exists: false,
    balance: 0n,
    rewardsFactorCheckpoint: 0n,
    claimableRewards: 0n,
    lifetimeRewards: 0n,
  };
  const data = res.value?.data?.[0];
  if (!data) return empty;
  const b = Buffer.from(data, "base64");
  if (b.length < 82) return empty;
  // disc[8] authority[32] initialized[1] bump[1] balance:u64@42
  // rewardsFactorCheckpoint:u128@50 claimableRewards:u64@66 lifetimeRewards:u64@74
  return {
    exists: true,
    balance: readU64(b, 42),
    rewardsFactorCheckpoint: readU128(b, 50),
    claimableRewards: readU64(b, 66),
    lifetimeRewards: readU64(b, 74),
  };
}

/** Raw SPL token account amount (for the strategy ATA / idle ATA). */
export async function readTokenAmount(rpc: Rpc, tokenAccount: Address): Promise<bigint> {
  const res = await rpc.getAccountInfo(tokenAccount, { encoding: "base64" }).send();
  const data = res.value?.data?.[0];
  if (!data) return 0n;
  const b = Buffer.from(data, "base64");
  if (b.length < 72) return 0n;
  return b.readBigUInt64LE(64); // SPL token account: amount @ offset 64
}
