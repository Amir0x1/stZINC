import React, { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { address, type Address } from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";
import { findVaultAssetIdleAuthPda } from "@voltr/vault-sdk";
import { DECIMALS, LP_MINT, STRATEGY, TOKEN_PROGRAM, VAULT, ZINC_MINT } from "./config";
import { buildDepositIxs, buildWithdrawIxs, deriveZincAccounts } from "./voltr";

function toRaw(human: string): bigint {
  const [w, f = ""] = human.trim().split(".");
  const frac = (f + "0".repeat(DECIMALS)).slice(0, DECIMALS);
  return BigInt(w || "0") * 10n ** BigInt(DECIMALS) + BigInt(frac || "0");
}
function fromRaw(raw: bigint): string {
  const base = 10n ** BigInt(DECIMALS);
  const frac = (raw % base).toString().padStart(DECIMALS, "0").replace(/0+$/, "");
  return `${raw / base}${frac ? "." + frac : ""}`;
}
async function ataOf(owner: string, mint: Address): Promise<PublicKey> {
  const [a] = await findAssociatedTokenPda({ owner: address(owner), mint, tokenProgram: TOKEN_PROGRAM });
  return new PublicKey(a);
}
async function tokenBalance(c: Connection, acc: PublicKey): Promise<bigint> {
  try {
    return BigInt((await c.getTokenAccountBalance(acc)).value.amount);
  } catch {
    return 0n;
  }
}

/**
 * Live staking APR from the ZINC pool. Rewards drip from the treasury's current
 * vesting bucket (`stakingUnvestedRewards`) over its slot window; we annualize
 * that rate against `totalStaked`. It is the *current* on-chain reward rate and
 * is variable (ZINC is a high-velocity token). Returns a fraction (0.45 = 45%),
 * or null when no bucket is actively vesting.
 */
const SLOTS_PER_YEAR = (365 * 24 * 3600) / 0.4; // ~0.4s/slot mainnet
async function stakingApr(c: Connection): Promise<number | null> {
  // STRATEGY id == the zinc treasury account.
  const info = await c.getAccountInfo(new PublicKey(STRATEGY));
  const d = info?.data;
  if (!d || d.length < 353) return null;
  const totalStaked = d.readBigUInt64LE(257);
  const unvested = d.readBigUInt64LE(329);
  const vLast = d.readBigUInt64LE(337);
  const vEnd = d.readBigUInt64LE(345);
  if (totalStaked === 0n || unvested === 0n || vEnd <= vLast) return 0;
  const window = Number(vEnd - vLast);
  const annual = (Number(unvested) / window) * SLOTS_PER_YEAR;
  return annual / Number(totalStaked);
}

export function App({ rpc, setRpc }: { rpc: string; setRpc: (v: string) => void }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [dep, setDep] = useState("");
  const [wd, setWd] = useState("");
  const [price, setPrice] = useState("—");
  const [apr, setApr] = useState<string>("—");
  const [balZinc, setBalZinc] = useState("—");
  const [balStzinc, setBalStzinc] = useState("—");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");

  const refresh = useCallback(async () => {
    try {
      const z = await deriveZincAccounts();
      const [idleAuth] = await findVaultAssetIdleAuthPda({ vault: VAULT });
      const idleAta = await ataOf(idleAuth, ZINC_MINT);
      const [idle, supply, stakeInfo] = await Promise.all([
        tokenBalance(connection, idleAta),
        connection.getTokenSupply(new PublicKey(LP_MINT)).then((r) => BigInt(r.value.amount)),
        connection.getAccountInfo(new PublicKey(z.stakePosition)),
      ]);
      let staked = 0n;
      if (stakeInfo && stakeInfo.data.length >= 82) staked = stakeInfo.data.readBigUInt64LE(42);
      const total = idle + staked;
      setPrice(supply === 0n ? "1.000000" : (Number(total) / Number(supply)).toFixed(6));

      const a = await stakingApr(connection);
      setApr(a == null ? "—" : `${(a * 100).toFixed(a >= 1 ? 0 : 1)}%`);

      if (publicKey) {
        const [z1, z2] = await Promise.all([
          tokenBalance(connection, await ataOf(publicKey.toBase58(), ZINC_MINT)),
          tokenBalance(connection, await ataOf(publicKey.toBase58(), LP_MINT)),
        ]);
        setBalZinc(fromRaw(z1));
        setBalStzinc(fromRaw(z2));
      }
    } catch (e: any) {
      setLog("read error: " + (e?.message ?? e));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20_000);
    return () => clearInterval(id);
  }, [refresh]);

  const send = useCallback(
    async (ixs: TransactionInstruction[]) => {
      if (!publicKey) return;
      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: blockhash,
        instructions: [
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }),
          ...ixs,
        ],
      }).compileToV0Message();
      const sig = await sendTransaction(new VersionedTransaction(msg), connection);
      setLog("sent: " + sig + "\nconfirming…");
      await connection.confirmTransaction(sig, "confirmed");
      setLog("✓ confirmed: https://solscan.io/tx/" + sig);
      await refresh();
    },
    [connection, publicKey, sendTransaction, refresh],
  );

  const doDeposit = async () => {
    if (!publicKey || !dep || Number(dep) <= 0) return setLog("enter a ZINC amount");
    try {
      setBusy(true);
      setLog("building deposit…");
      await send(await buildDepositIxs(publicKey.toBase58(), toRaw(dep)));
    } catch (e: any) {
      setLog("deposit failed: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const doWithdraw = async () => {
    if (!publicKey) return;
    if (!wd || isNaN(Number(wd)) || Number(wd) <= 0) return setLog("enter a stZINC amount");
    const balRaw = balStzinc === "—" ? 0n : toRaw(balStzinc);
    const amt = toRaw(wd);
    // Redeem-all when the input is at (or above) the full balance — avoids dust.
    const isAll = balRaw > 0n && amt >= balRaw;
    // The vault requires a non-zero LP amount even for redeem-all, so always pass
    // the actual LP amount (clamped to the balance for "all").
    const lp = isAll ? balRaw : amt;
    try {
      setBusy(true);
      setLog("building redeem…");
      await send(await buildWithdrawIxs(publicKey.toBase58(), lp, isAll));
    } catch (e: any) {
      setLog("redeem failed: " + (e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wrap">
      <header>
        <h1>
          stZINC <small>liquid staked ZINC · Voltr</small>
        </h1>
        <WalletMultiButton />
      </header>

      <div className="card" style={{ textAlign: "center" }}>
        <div className="k" style={{ color: "var(--muted)", fontSize: 12 }}>
          Staking APR · live ZINC pool rate
        </div>
        <div style={{ fontSize: 34, fontWeight: 800, color: "var(--accent)", lineHeight: 1.2 }}>
          {apr}
        </div>
        <div className="muted">variable — annualized current on-chain reward rate, auto-compounded into stZINC</div>
      </div>

      <div className="card stats">
        <div className="stat">
          <div className="k">Price (ZINC/stZINC)</div>
          <div className="v">{price}</div>
        </div>
        <div className="stat">
          <div className="k">Your ZINC</div>
          <div className="v">{balZinc}</div>
        </div>
        <div className="stat">
          <div className="k">Your stZINC</div>
          <div className="v">{balStzinc}</div>
        </div>
      </div>

      <div className="card">
        <div className="tabs">
          <button className={tab === "deposit" ? "active" : ""} onClick={() => setTab("deposit")}>
            Deposit
          </button>
          <button className={tab === "withdraw" ? "active" : ""} onClick={() => setTab("withdraw")}>
            Withdraw
          </button>
        </div>

        {tab === "deposit" ? (
          <>
            <label>Deposit ZINC, receive stZINC</label>
            <div className="row">
              <input value={dep} onChange={(e) => setDep(e.target.value)} inputMode="decimal" placeholder="0.0" />
              <button className="maxbtn" onClick={() => setDep(balZinc === "—" ? "" : balZinc)}>
                MAX
              </button>
            </div>
            <div className="row">
              <button style={{ flex: 1 }} disabled={!connected || busy} onClick={doDeposit}>
                {busy ? "…" : "Deposit"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label>Redeem stZINC, receive ZINC (direct from the staking pool)</label>
            <div className="row">
              <input value={wd} onChange={(e) => setWd(e.target.value)} inputMode="decimal" placeholder="0.0" />
              <button className="maxbtn" onClick={() => setWd(balStzinc === "—" ? "" : balStzinc)}>
                MAX
              </button>
            </div>
            <div className="row">
              <button style={{ flex: 1 }} disabled={!connected || busy} onClick={doWithdraw}>
                {busy ? "…" : "Redeem"}
              </button>
            </div>
          </>
        )}
        <div id="log">{log}</div>
      </div>

      <div className="card">
        <label>RPC endpoint (use your Helius/QuickNode URL for reliability)</label>
        <input className="rpc" value={rpc} onChange={(e) => setRpc(e.target.value)} placeholder="https://…" />
        <div className="muted" style={{ marginTop: 8 }}>
          Deposits mint stZINC at the current NAV; a keeper stakes idle ZINC into the zinc pool.
          Redemptions unstake directly. stZINC only grows vs ZINC.
        </div>
      </div>
    </div>
  );
}
