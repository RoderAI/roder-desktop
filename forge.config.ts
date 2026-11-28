import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import type { Options as ElectronPackagerOptions } from "@electron/packager";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const verifiedPackagingNodeMajors = new Set([24, 25]);
const devBuild = process.env.RODER_DESKTOP_DEV_BUILD === "1";
const appName = devBuild ? "Roder Dev" : "Roder";
const icon = devBuild ? "resources/icon-dev" : "resources/icon";
const shouldSignMac = !devBuild && process.env.RODER_DESKTOP_MACOS_SIGN === "1";
const macSigningIdentity =
  process.env.APPLE_SIGNING_IDENTITY ?? "Developer ID Application: Pandelis Zembashis (7UNZ734ZYN)";

const config: ForgeConfig = {
  packagerConfig: {
    name: appName,
    executableName: appName,
    appBundleId: devBuild ? "sc.roder.desktop.dev" : "sc.roder.desktop",
    appCategoryType: "public.app-category.developer-tools",
    icon,
    asar: {
      unpack: "**/node_modules/node-pty/**",
    },
    extraResource: ["resources/bin", `${icon}.png`, "resources/wordmark.png"],
    ...(shouldSignMac
      ? {
          osxSign: {
            identity: macSigningIdentity,
            keychain: process.env.CSC_KEYCHAIN,
            strictVerify: true,
            continueOnError: false,
          } as ElectronPackagerOptions["osxSign"],
        }
      : {}),
  },
  rebuildConfig: {},
  hooks: {
    async prePackage(_config, platform) {
      if (devBuild && platform !== "darwin") {
        throw new Error("The local Roder Dev package currently targets macOS.");
      }
      // On Node 26 electron-forge's package step ends with exit code 0 and writes nothing, so a broken
      // build looks like a successful one. Fail here instead. CI packages on Node 24.
      const nodeMajor = Number(process.versions.node.split(".")[0]);
      if (!verifiedPackagingNodeMajors.has(nodeMajor) && process.env.RODER_ALLOW_UNVERIFIED_NODE !== "1") {
        throw new Error(
          `Packaging is verified on Node 24 (the CI version) and 25. Running ${process.version} can exit 0 without writing a package. ` +
            "Switch Node (for example `nvm use 24`), or set RODER_ALLOW_UNVERIFIED_NODE=1 to build anyway.",
        );
      }

      const script = devBuild ? "scripts/bundle-roder.mjs" : "scripts/install-roder-for-build.mjs";
      const result = spawnSync(process.execPath, [script], {
        stdio: "inherit",
        env: process.env,
      });

      if (result.error) {
        throw result.error;
      }
      if (result.status !== 0) {
        throw new Error(`${script} failed with status ${result.status ?? "unknown"}`);
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
      const buildReleaseSource = path.join(nodePtySource, "build", "Release");
      const buildReleaseTarget = path.join(nodePtyTarget, "build", "Release");
      if (existsSync(prebuildSource)) {
        await cp(prebuildSource, prebuildTarget, { recursive: true });

        const spawnHelper = path.join(prebuildTarget, "spawn-helper");
        if (platform === "darwin" && existsSync(spawnHelper)) {
          await chmod(spawnHelper, 0o755);
        }
      } else if (
        platform === process.platform &&
        arch === process.arch &&
        existsSync(path.join(buildReleaseSource, "pty.node"))
      ) {
        await cp(buildReleaseSource, buildReleaseTarget, { recursive: true });
      } else {
        throw new Error(
          `Cannot package node-pty because neither ${prebuildSource} nor ${path.join(buildReleaseSource, "pty.node")} is present`,
        );
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
