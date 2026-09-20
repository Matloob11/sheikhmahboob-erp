/// <reference types="vitest/config" />
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function daftarManifest(): Plugin {
  return {
    name: "daftar-manifest",
    generateBundle() {
      const live = process.env.PRA_LIVE_BASE === "1";
      const base = live ? "/pra/" : "/";
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: `${JSON.stringify(
          {
            name: "Daftar",
            short_name: "Daftar",
            description: "Local-first PRA eIMS / POS desk. Client files stay in this browser.",
            start_url: base,
            scope: base,
            display: "standalone",
            background_color: "#efe6d6",
            theme_color: "#efe6d6",
            icons: [{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), daftarManifest()],
  // Never pass --base=/pra/ from Git Bash — MSYS rewrites that to
  // "/Program Files/Git/pra/". Live builds set PRA_LIVE_BASE=1 instead.
  base: process.env.PRA_LIVE_BASE === "1" ? "/pra/" : "/",
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.VITE_APP_BUILD_TIME": JSON.stringify(new Date().toISOString()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/exceljs") || id.includes("/exceljs/")) return "excel";
        },
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/pra-ims": {
        target: "https://ims.pral.com.pk",
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/pra-ims/, ""),
      },
    },
  },
});
