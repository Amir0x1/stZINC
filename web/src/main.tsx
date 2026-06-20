import { Buffer } from "buffer";
(globalThis as any).Buffer = (globalThis as any).Buffer ?? Buffer;

import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";
import { DEFAULT_RPC } from "./config";
import { App } from "./App";

/**
 * Wallet-adapter providers. An empty `wallets` array still surfaces every
 * Wallet-Standard wallet (Phantom, Solflare, Backpack, …) in the connect modal —
 * no wallet is hardcoded.
 */
function Root() {
  const [rpc, setRpc] = useState(
    () => localStorage.getItem("stzinc_rpc") || DEFAULT_RPC,
  );
  const endpoint = useMemo(() => rpc.trim() || DEFAULT_RPC, [rpc]);

  return (
    <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>
          <App
            rpc={rpc}
            setRpc={(v) => {
              setRpc(v);
              localStorage.setItem("stzinc_rpc", v);
            }}
          />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById("root")!).render(<Root />);
