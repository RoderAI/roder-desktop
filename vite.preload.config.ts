import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const external = [
  "electron",
  "electron/common",
  ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
];

export default defineConfig({
  build: {
    rollupOptions: {
      external: [...external, "electron/renderer"],
      output: {
        entryFileNames: "preload.cjs",
        chunkFileNames: "preload.cjs",
      },
    },
  },
});
