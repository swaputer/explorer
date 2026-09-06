import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "node:crypto": fileURLToPath(new URL("./src/lib/nodeCryptoShim.ts", import.meta.url))
    }
  },
  server: { host: "127.0.0.1", port: 4173 },
  preview: { host: "127.0.0.1", port: 4173 }
});
