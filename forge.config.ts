import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir } from "node:fs/promises";
import path from "node:path";
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
      unpack: "**/node_modules/node-pty/**",
    },
    extraResource: ["resources/bin", "resources/icon.png", "resources/wordmark.png"],
  },
  rebuildConfig: {},
  hooks: {
    async prePackage() {
      const result = spawnSync(process.execPath, ["scripts/install-roder-for-build.mjs"], {
        stdio: "inherit",
        env: process.env,
      });

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`install-roder-for-build failed with status ${result.status ?? "unknown"}`);
      }
    },
    async packageAfterPrune(_config, buildPath, _electronVersion, platform, arch) {
      const nodePtySource = path.resolve("node_modules/node-pty");
      if (!existsSync(nodePtySource)) {
        throw new Error("Cannot package node-pty because node_modules/node-pty is missing");
      }

      const nodePtyTarget = path.join(buildPath, "node_modules", "node-pty");
      await mkdir(nodePtyTarget, { recursive: true });

      await cp(path.join(nodePtySource, "package.json"), path.join(nodePtyTarget, "package.json"));
      await cp(path.join(nodePtySource, "lib"), path.join(nodePtyTarget, "lib"), { recursive: true });

      const prebuildSource = path.join(nodePtySource, "prebuilds", `${platform}-${arch}`);
      const prebuildTarget = path.join(nodePtyTarget, "prebuilds", `${platform}-${arch}`);
      if (!existsSync(prebuildSource)) {
        throw new Error(`Cannot package node-pty because ${prebuildSource} is missing`);
      }
      await cp(prebuildSource, prebuildTarget, { recursive: true });

      const spawnHelper = path.join(prebuildTarget, "spawn-helper");
      if (platform === "darwin" && existsSync(spawnHelper)) {
        await chmod(spawnHelper, 0o755);
      }
    },
  },
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
