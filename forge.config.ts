import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  packagerConfig: {
    name: "Roder",
    executableName: "Roder",
    appBundleId: "sc.roder.desktop",
    icon: "resources/icon",
    asar: {
      unpack: "node_modules/node-pty/**",
    },
    extraResource: ["resources/bin", "resources/icon.png", "resources/wordmark.png"],
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({ setupIcon: "resources/icon.ico" }, ["win32"]),
    new MakerDMG({ icon: "resources/icon.icns" }, ["darwin"]),
    new MakerZIP({}, ["darwin"]),
    new MakerRpm({}, ["linux"]),
    new MakerDeb({}, ["linux"]),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "electron/main/index.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "electron/preload/index.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
