import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import babel from "@rolldown/plugin-babel";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": resolve(root, "src"),
    },
  },
  plugins: [TanStackRouterVite(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  build: {
    rollupOptions: {
      input: resolve(root, "index.html"),
    },
  },
});
