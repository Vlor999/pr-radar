import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
const src = (p: string) => path.resolve(import.meta.dirname, "./src", p);

// `npm run demo` : l'app dans un navigateur, Tauri et GitHub remplacés par src/demo/*
const demoAlias = [
  { find: /^(\.\/|@\/lib\/)github$/, replacement: src("demo/github.ts") },
  { find: /^@tauri-apps\/(api\/(core|app)|plugin-.*)$/, replacement: src("demo/tauri.ts") },
];

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      ...(mode === "demo" ? demoAlias : []),
      { find: "@", replacement: src("") },
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
