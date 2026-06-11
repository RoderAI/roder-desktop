import { builtinModules } from "node:module";
import { defineConfig } from "vite";
import type { ConfigEnv } from "vite";

const external = [
  "electron",
  "electron/common",
  ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
];

type ForgeBuildEnv = ConfigEnv<"build"> & {
  forgeConfigSelf: {
    entry: string;
  };
};

export default defineConfig((env) => ({
  build: {
    lib: {
      entry: (env as ForgeBuildEnv).forgeConfigSelf.entry,
      fileName: () => "[name].cjs",
      formats: ["cjs"],
    },
    rollupOptions: {
      external: [...external, "electron/main"],
    },
  },
}));
