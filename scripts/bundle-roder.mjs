import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceParent = dirname(root);
const sourceDirectoryName = basename(root).endsWith("-desktop")
  ? basename(root).slice(0, -"desktop".length).replace(/-$/, "")
  : "gode";
const siblingSource = resolve(workspaceParent, sourceDirectoryName);
const roderSource = resolve(process.env.RODER_SOURCE_DIR ?? siblingSource);
const output = resolve(root, "resources", "bin", process.platform === "win32" ? "roder.exe" : "roder");

if (!existsSync(resolve(roderSource, "Cargo.toml"))) {
  console.warn(`[bundle:roder] skipping: no Cargo workspace at ${roderSource}`);
  process.exit(0);
}

mkdirSync(dirname(output), { recursive: true });

console.log(`[bundle:roder] building roder at ${roderSource}`);
const result = spawnSync("cargo", ["build", "-p", "roder-cli", "--bin", "roder"], {
  cwd: roderSource,
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

const builtBinary = resolve(
  roderSource,
  "target",
  "debug",
  process.platform === "win32" ? "roder.exe" : "roder",
);
const copied = spawnSync("cp", [builtBinary, output], {
  stdio: "inherit",
});
if (copied.status !== 0) {
  process.exit(copied.status ?? 1);
}

if (process.platform === "darwin") {
  const signed = spawnSync("codesign", ["--force", "--sign", "-", output], {
    stdio: "inherit",
  });
  if (signed.status !== 0) {
    process.exit(signed.status ?? 1);
  }
}

console.log(`[bundle:roder] wrote ${output}`);
