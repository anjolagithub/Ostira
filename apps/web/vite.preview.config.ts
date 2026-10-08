import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Single self-contained HTML file: the console UI plus a snapshot of real engine output.
export default defineConfig({
  root: "preview",
  plugins: [react(), viteSingleFile()],
  build: { outDir: "../dist-preview", emptyOutDir: true, assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 10_000 },
});
