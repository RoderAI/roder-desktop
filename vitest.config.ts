import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(root, "src"),
      "@roderai/extension-api": resolve(root, "packages/extension-api/src/index.ts"),
    },
  },
  test: {
    coverage: {
      include: ["src/**/*.{ts,tsx}", "electron/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html"],
    },
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
