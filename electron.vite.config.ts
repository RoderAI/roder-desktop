import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(root, "electron/main/index.ts"),
        formats: ["es"],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(root, "electron/preload/index.ts"),
        formats: ["es"],
      },
    },
  },
  renderer: {
    root,
    resolve: {
      alias: {
        "@": resolve(root, "src"),
      },
    },
    plugins: [
      TanStackRouterVite(),
      react({
        babel: {
          plugins: ["babel-plugin-react-compiler"],
        },
      }),
      tailwindcss(),
    ],
    build: {
      rollupOptions: {
        input: resolve(root, "index.html"),
      },
    },
  },
});
