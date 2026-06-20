import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Polyfill globals that @solana/web3.js + wallet-adapter expect in the browser.
export default defineConfig({
  plugins: [react()],
  define: {
    global: "globalThis",
    "process.env": {},
  },
  resolve: {
    alias: { buffer: "buffer" },
  },
});
