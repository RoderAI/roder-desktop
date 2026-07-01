import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { notarize } from "@electron/notarize";
import type { ForgeConfig } from "@electron-forge/shared-types";
import type { Options as ElectronPackagerOptions } from "@electron/packager";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { VitePlugin } from "@electron-forge/plugin-vite";

const shouldSignMac = process.env.RODER_DESKTOP_MACOS_SIGN === "1";
const macSigningIdentity =
  process.env.APPLE_SIGNING_IDENTITY ?? "Developer ID Application: Pandelis Zembashis (7UNZ734ZYN)";

function macNotarizeCredentials() {
  const appleApiKey = process.env.APPLE_NOTARIZE_KEY_PATH;
  const appleApiKeyId = process.env.APPLE_NOTARIZE_KEY_ID;
  const appleApiIssuer = process.env.APPLE_NOTARIZE_ISSUER_ID;
  if (!shouldSignMac || !appleApiKey || !appleApiKeyId || !appleApiIssuer) {
    return null;
  }

  return { appleApiKey, appleApiKeyId, appleApiIssuer };
}

async function collectMatchingPaths(root: string, matcher: (candidate: string) => boolean): Promise<string[]> {
  if (!existsSync(root)) {
    return [];
  }
  if (matcher(root)) {
    return [root];
  }

  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    return [];
  }

  const matches: string[] = [];
  for (const entry of await readdir(root)) {
    const candidate = path.join(root, entry);
    if (matcher(candidate)) {
      matches.push(candidate);
      continue;
    }

    const candidateStat = await stat(candidate);
    if (candidateStat.isDirectory()) {
      matches.push(...(await collectMatchingPaths(candidate, matcher)));
    }
  }
  return matches;
}

async function notarizeMacApp(appPath: string) {
  const credentials = macNotarizeCredentials();
  if (!credentials) {
    return;
  }

  await notarize({
    appPath,
    ...credentials,
  });
}

async function notarizeMacDmg(dmgPath: string) {
  const credentials = macNotarizeCredentials();
  if (!credentials) {
    return;
  }

  const signArgs = ["--force", "--sign", macSigningIdentity, "--timestamp"];
  if (process.env.CSC_KEYCHAIN) {
    signArgs.push("--keychain", process.env.CSC_KEYCHAIN);
  }
  signArgs.push(dmgPath);

  const result = spawnSync("codesign", signArgs, { stdio: "inherit" });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`codesign failed for ${dmgPath} with status ${result.status ?? "unknown"}`);
  }

  await notarize({
    appPath: dmgPath,
    ...credentials,
  });
}

const config: ForgeConfig = {
  packagerConfig: {
    name: "Roder",
    executableName: "Roder",
    appBundleId: "sc.roder.desktop",
    appCategoryType: "public.app-category.developer-tools",
    icon: "resources/icon",
    asar: {
      unpack: "**/node_modules/node-pty/**",
    },
    extraResource: ["resources/bin", "resources/icon.png", "resources/wordmark.png"],
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
    async postPackage(_config, packageResult) {
      if (packageResult.platform !== "darwin") {
        return;
      }

      const appPaths = (
        await Promise.all(
          packageResult.outputPaths.map((outputPath) =>
            collectMatchingPaths(outputPath, (candidate) => candidate.endsWith(".app")),
          ),
        )
      ).flat();

      for (const appPath of appPaths) {
        await notarizeMacApp(appPath);
      }
    },
    async postMake(_config, makeResults) {
      for (const result of makeResults) {
        if (result.platform !== "darwin") {
          continue;
        }

        for (const artifact of result.artifacts) {
          if (artifact.endsWith(".dmg")) {
            await notarizeMacDmg(artifact);
          }
        }
      }

      return makeResults;
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
